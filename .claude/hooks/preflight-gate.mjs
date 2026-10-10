/**
 * Shell-command gate: deny `git commit` until the tomtom-mcp-preflight skill has
 * passed once in the agent session.
 *
 * There are no git hooks in this repository, so a commit is otherwise ungated.
 * The denial names the command that records a pass — `node preflight-gate.mjs
 * --passed <session>` — which the skill runs when its verdict is ready, or the
 * agent runs when the user asked to commit without preflight. A retry alone stays
 * denied, yet nothing can deadlock. It is a prompt, not enforcement.
 *
 * Wired as a Claude Code PreToolUse(Bash|PowerShell) hook from .claude/settings.json
 * and as a Cursor beforeShellExecution hook from .cursor/hooks.json; the payload
 * shape tells the two apart. Both configs filter on the command text, so node
 * starts only for commands that mention a git commit — keep them narrow, since
 * every start costs hundreds of milliseconds on Windows.
 */
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `git commit`, `git -C "<dir with spaces>" commit`, `git add -A && git commit` —
// but not `git commit-tree`, `git log --grep=commit` or a sha passed to `git show`.
const COMMIT_PATTERN =
  /\bgit(?:\s+-\S+(?:\s+(?:"[^"]*"|'[^']*'|[^\s-]\S*))?)*\s+commit(?![\w-])/;

const PASSED_FLAG = "--passed";

const markerPath = (sessionKey) =>
  join(tmpdir(), `tomtom-mcp-preflight-${sessionKey.replace(/[^\w-]/g, "")}`);

const denialReason = (sessionKey) => {
  const recordPass = `node "${fileURLToPath(import.meta.url)}" ${PASSED_FLAG} ${sessionKey}`;
  return (
    "This repository has no git hooks, so preflight is the only gate before CI. Run the " +
    "tomtom-mcp-preflight skill's commit tier; when its verdict is ready to commit, record " +
    `the pass with \`${recordPass}\` and re-run this command. If the user asked to commit ` +
    "without preflight, record the pass and re-run — the gate stays open for the rest of " +
    "this session."
  );
};

const readStdin = async () => {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  return payload;
};

const parseHookInput = (payload) => {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
};

const recordPass = (sessionKey) => {
  if (!sessionKey) {
    console.error(`Usage: node preflight-gate.mjs ${PASSED_FLAG} <session id from the denial>`);
    process.exit(1);
  }
  writeFileSync(markerPath(sessionKey), "");
  console.log("Preflight pass recorded: git commit is open for the rest of this session.");
};

const gate = async () => {
  const input = parseHookInput(await readStdin());
  const isClaudeCode = input.tool_input !== undefined;
  const command = (isClaudeCode ? input.tool_input.command : input.command) ?? "";
  // Claude Code and Cursor always send an id; the date stops a payload without one
  // from sharing a single marker with every later session on the machine.
  const sessionKey =
    input.session_id ??
    input.conversation_id ??
    `unknown-${new Date().toISOString().slice(0, 10)}`;

  if (COMMIT_PATTERN.test(command) && !existsSync(markerPath(sessionKey))) {
    const reason = denialReason(sessionKey);
    const denial = isClaudeCode
      ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }
      : { permission: "deny", user_message: reason, agent_message: reason };
    console.log(JSON.stringify(denial));
  } else if (!isClaudeCode) {
    // Cursor expects a decision on stdout; Claude Code treats silence as "proceed".
    console.log(JSON.stringify({ permission: "allow" }));
  }
};

if (process.argv[2] === PASSED_FLAG) {
  recordPass(process.argv[3]);
} else {
  await gate();
}
