/**
 * Fetches what the reviewer reads about a pull request into the review directory: pr.json (title,
 * description, base and head), threads.json (the review threads) and reviews.md (the bodies of
 * earlier agent reviews). Prints N, BASE_REF and HEAD_SHA for the rest of the setup.
 *
 * Each docs-portal PR the description's `Docs portal:` line links gets the same files in docs-<N>/, plus its diff.patch
 * and tree/, a sparse checkout of the MCP pages at its head. Prints DOCS_PRS, empty when none.
 * `--docs <N>` fetches one docs-portal PR alone, for a local branch.
 *
 * Every `gh` read is here so that the skill runs one plain command, which Claude Code's sandbox
 * can exclude: a call with a redirect or `$(...)` stays sandboxed, where `gh` cannot read its token.
 *
 * node fetchPr.mjs <#N | N | PR link> <review dir>
 * node fetchPr.mjs --docs <N> <review dir>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_MARKER } from "./reviewMarker.mjs";

const REPO = "tomtom-international/tomtom-maps-mcp";
const DOCS_REPO = "tomtom-internal/devportal-documentation";
const DOCS_PAGES = "documentation/tomtom-maps-mcp";
// The sibling sits on the description's `Docs portal:` line; a docs PR cited elsewhere is evidence.
const DOCS_PORTAL_LINE = /^Docs portal:.*$/gim;
const DOCS_PR_LINK = /(?:github\.com\/tomtom-internal\/devportal-documentation\/pull\/|tomtom-internal\/devportal-documentation#)(\d+)/g;
// A thread's first comment states the point; its latest replies settle it ("fixed in abc123").
const THREADS_QUERY = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { reviewThreads(first: 100) { nodes { isResolved isOutdated path line
    opening: comments(first: 1) { nodes { id author { login } body } }
    latest: comments(last: 3) { nodes { id author { login } body } } } } } } }`;

const args = process.argv.slice(2);
const docsOnly = args[0] === "--docs";
const [target, reviewDir] = docsOnly ? args.slice(1) : args;

if (!target || !reviewDir) {
  console.error(
    "Usage: node fetchPr.mjs <#N | N | PR link> <review dir>\n" +
      "       node fetchPr.mjs --docs <N> <review dir>"
  );
  process.exit(1);
}

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gh = (...ghArgs) => run("gh", ghArgs);

function fetchPullRequest(repo, number, fields) {
  return JSON.parse(gh("pr", "view", String(number), "--repo", repo, "--json", fields));
}

function writeConversation(repo, pr, directory) {
  const [owner, name] = repo.split("/");
  const threads = JSON.parse(
    gh(
      "api",
      "graphql",
      "-F",
      `n=${pr.number}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `query=${THREADS_QUERY}`
    )
  ).data.repository.pullRequest.reviewThreads.nodes.map(({ opening, latest, ...thread }) => {
    const [first] = opening.nodes;
    const replies = latest.nodes.filter((comment) => comment.id !== first.id);
    return { ...thread, comments: [first, ...replies].map(({ id, ...comment }) => comment) };
  });

  const reviews = gh(
    "api",
    `repos/${repo}/pulls/${pr.number}/reviews`,
    "--paginate",
    "--jq",
    `.[] | select(.body | startswith("${REVIEW_MARKER}")) | .body`
  );

  writeFileSync(join(directory, "pr.json"), `${JSON.stringify(pr, null, 2)}\n`);
  writeFileSync(join(directory, "threads.json"), `${JSON.stringify(threads, null, 2)}\n`);
  writeFileSync(join(directory, "reviews.md"), reviews);
}

/** Checks the MCP pages out at the PR's head; `pull/<N>/head` outlives a deleted branch. */
function checkOutDocsHead(number, tree) {
  gh("repo", "clone", DOCS_REPO, tree, "--", "--depth", "1", "--filter=blob:none", "--sparse",
    "--no-checkout", "--quiet");
  run("git", ["-C", tree, "sparse-checkout", "set", DOCS_PAGES]);
  run("git", ["-C", tree, "fetch", "--quiet", "--depth", "1", "origin", `pull/${number}/head`]);
  run("git", ["-C", tree, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
}

/** Returns false when the PR can't be read, such as without access to the internal repository. */
function fetchDocsPullRequest(number) {
  const directory = join(reviewDir, `docs-${number}`);
  mkdirSync(directory, { recursive: true });
  try {
    const pr = fetchPullRequest(
      DOCS_REPO,
      number,
      "number,title,body,url,state,isDraft,baseRefName,headRefName,headRefOid"
    );
    writeConversation(DOCS_REPO, pr, directory);
    writeFileSync(join(directory, "diff.patch"), gh("pr", "diff", String(number), "--repo", DOCS_REPO));
    checkOutDocsHead(number, join(directory, "tree"));
    return true;
  } catch (error) {
    writeFileSync(join(directory, "unavailable.txt"), `${error.message}\n`);
    console.error(`${DOCS_REPO}#${number} is unavailable: ${error.message.split("\n")[0]}`);
    return false;
  }
}

if (docsOnly) {
  const fetched = fetchDocsPullRequest(target.replace(/^#/, ""));
  console.log(`DOCS_PRS=${fetched ? target.replace(/^#/, "") : ""}`);
  process.exit(0);
}

const pr = fetchPullRequest(REPO, target.replace(/^#/, ""), "number,title,body,url,baseRefName,headRefOid");

if (!pr.url.startsWith(`https://github.com/${REPO}/pull/`)) {
  console.error(`${pr.url} is not a pull request of ${REPO}.`);
  process.exit(1);
}

writeConversation(REPO, pr, reviewDir);

const docsPortalLines = (pr.body ?? "").match(DOCS_PORTAL_LINE) ?? [];
const docsNumbers = [
  ...new Set(docsPortalLines.flatMap((line) => [...line.matchAll(DOCS_PR_LINK)].map((match) => match[1]))),
];
const fetchedDocs = docsNumbers.filter(fetchDocsPullRequest);

console.log(
  `N=${pr.number} BASE_REF=origin/${pr.baseRefName} HEAD_SHA=${pr.headRefOid} DOCS_PRS=${fetchedDocs.join(",")}`
);
