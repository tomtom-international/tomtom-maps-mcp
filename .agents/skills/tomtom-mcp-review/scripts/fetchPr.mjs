/**
 * Fetches what the reviewer reads about a pull request into the review directory: pr.json (title,
 * description, base and head), threads.json (the review threads) and reviews.md (the bodies of
 * earlier agent reviews). Prints N, BASE_REF and HEAD_SHA for the rest of the setup.
 *
 * Every `gh` read is here so that the skill runs one plain command, which Claude Code's sandbox
 * can exclude: a call with a redirect or `$(...)` stays sandboxed, where `gh` cannot read its token.
 *
 * node fetchPr.mjs <#N | N | PR link> <review dir>
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "tomtom-international/tomtom-maps-mcp";
const REVIEW_MARKER = "<!-- tomtom-mcp-review";
// A thread's first comment states the point; its latest replies settle it ("fixed in abc123").
const THREADS_QUERY = `query($n: Int!) { repository(owner: "tomtom-international", name: "tomtom-maps-mcp") {
  pullRequest(number: $n) { reviewThreads(first: 100) { nodes { isResolved isOutdated path line
    opening: comments(first: 1) { nodes { id author { login } body } }
    latest: comments(last: 3) { nodes { id author { login } body } } } } } } }`;

const [target, reviewDir] = process.argv.slice(2);

if (!target || !reviewDir) {
  console.error("Usage: node fetchPr.mjs <#N | N | PR link> <review dir>");
  process.exit(1);
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const pr = JSON.parse(
  gh(
    "pr",
    "view",
    target.replace(/^#/, ""),
    "--repo",
    REPO,
    "--json",
    "number,title,body,url,baseRefName,headRefOid"
  )
);

if (!pr.url.startsWith(`https://github.com/${REPO}/pull/`)) {
  console.error(`${pr.url} is not a pull request of ${REPO}.`);
  process.exit(1);
}

const threads = JSON.parse(
  gh("api", "graphql", "-F", `n=${pr.number}`, "-f", `query=${THREADS_QUERY}`)
).data.repository.pullRequest.reviewThreads.nodes.map(({ opening, latest, ...thread }) => {
  const [first] = opening.nodes;
  const replies = latest.nodes.filter((comment) => comment.id !== first.id);
  return { ...thread, comments: [first, ...replies].map(({ id, ...comment }) => comment) };
});

const reviews = gh(
  "api",
  `repos/${REPO}/pulls/${pr.number}/reviews`,
  "--paginate",
  "--jq",
  `.[] | select(.body | startswith("${REVIEW_MARKER}")) | .body`
);

writeFileSync(join(reviewDir, "pr.json"), `${JSON.stringify(pr, null, 2)}\n`);
writeFileSync(join(reviewDir, "threads.json"), `${JSON.stringify(threads, null, 2)}\n`);
writeFileSync(join(reviewDir, "reviews.md"), reviews);

console.log(`N=${pr.number} BASE_REF=origin/${pr.baseRefName} HEAD_SHA=${pr.headRefOid}`);
