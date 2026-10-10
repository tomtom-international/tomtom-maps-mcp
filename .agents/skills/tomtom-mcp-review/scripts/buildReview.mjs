/**
 * Turns the reviewer's findings files into the payload of one GitHub pull request review.
 *
 * A finding whose line sits inside a hunk of the diff becomes an inline comment; any other moves
 * into the review body, since GitHub rejects the whole review with a 422 when a single comment
 * cannot be anchored.
 *
 * node buildReview.mjs --diff diff.patch --commit <sha> findings*.json > review.json
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const KIND_LABELS = {
  bug: "Bug",
  reuse: "Reuse",
  types: "Types",
  guidelines: "Guidelines",
  tests: "Tests",
  docs: "Docs",
  inconsistency: "Inconsistency",
};
const SEVERITIES = ["blocking", "suggestion", "nit"];
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const { values, positionals } = parseArgs({
  options: { diff: { type: "string" }, commit: { type: "string" } },
  allowPositionals: true,
});

if (!values.diff || !values.commit || positionals.length === 0) {
  console.error(
    "Usage: node buildReview.mjs --diff <diff.patch> --commit <sha> <findings.json>..."
  );
  process.exit(1);
}

// `a/<path>` or `b/<path>`; `/dev/null` for the missing side of an added or deleted file.
const diffPath = (header) => (header === "/dev/null" ? undefined : header.replace(/^[ab]\//, ""));

const anchorKey = (side, path, line) => `${side}:${path}:${line}`;

const collectAnchors = (diff) => {
  const anchors = new Set();
  let leftPath;
  let rightPath;
  let left = 0;
  let right = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      left = Number(hunk[1]);
      right = Number(hunk[2]);
      inHunk = true;
    } else if (line.startsWith("diff --git ")) {
      inHunk = false;
    } else if (!inHunk && line.startsWith("--- ")) {
      leftPath = diffPath(line.slice(4));
    } else if (!inHunk && line.startsWith("+++ ")) {
      rightPath = diffPath(line.slice(4));
    } else if (inHunk && line.startsWith("+")) {
      anchors.add(anchorKey("RIGHT", rightPath, right++));
    } else if (inHunk && line.startsWith("-")) {
      anchors.add(anchorKey("LEFT", leftPath, left++));
    } else if (inHunk && line.startsWith(" ")) {
      anchors.add(anchorKey("RIGHT", rightPath, right++));
      anchors.add(anchorKey("LEFT", leftPath, left++));
    }
  }
  return anchors;
};

const label = (finding) => `**${KIND_LABELS[finding.kind] ?? finding.kind}** (${finding.severity})`;

const location = (finding) => {
  if (!finding.path) return "";

  return finding.line ? `\`${finding.path}:${finding.line}\`: ` : `\`${finding.path}\`: `;
};

const section = (heading, lines) =>
  lines.length ? ["", ...(heading ? [heading] : []), ...lines] : [];

const bySeverity = (first, second) =>
  SEVERITIES.indexOf(first.severity) - SEVERITIES.indexOf(second.severity);

const reports = positionals.map((file) => JSON.parse(readFileSync(file, "utf8")));
const findings = reports.flatMap((report) => report.findings ?? []).sort(bySeverity);
const anchors = collectAnchors(readFileSync(values.diff, "utf8"));

const isAnchored = (finding) =>
  finding.path &&
  finding.line &&
  anchors.has(anchorKey(finding.side ?? "RIGHT", finding.path, finding.line));

const inline = findings.filter(isAnchored);
const unanchored = findings.filter((finding) => !isAnchored(finding));
const notChecked = reports.flatMap((report) => report.notChecked ?? []);
const summary = reports.map((report) => report.summary).join(" ");

const body = [
  `<!-- tomtom-mcp-review head=${values.commit} -->`,
  `**Agent review** of \`${values.commit.slice(0, 9)}\`: ${summary}`,
  ...section(
    undefined,
    unanchored.map((finding) => `- ${label(finding)} ${location(finding)}${finding.body}`)
  ),
  ...section(
    "**Not checked**",
    notChecked.map((item) => `- ${item}`)
  ),
].join("\n");

const review = {
  commit_id: values.commit,
  event: "COMMENT",
  body,
  comments: inline.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: finding.side ?? "RIGHT",
    body: `${label(finding)} ${finding.body}`,
  })),
};

console.log(JSON.stringify(review, null, 2));
console.error(`${inline.length} inline, ${unanchored.length} in the review body.`);
