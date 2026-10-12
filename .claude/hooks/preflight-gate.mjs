/**
 * Denies an agent's `git commit` until tomtom-mcp-preflight has passed once in the session.
 * The denial names the `--passed <session>` command that records a pass: a prompt, not enforcement.
 *
 * .claude/settings.json and .cursor/hooks.json start node only for commit commands, as each start
 * costs hundreds of milliseconds on Windows. Cursor imports the first, ignoring `if` and `args`,
 * so its Bash handler exits on CURSOR_VERSION and its PowerShell group never matches there.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `git commit`, `git -C "<dir with spaces>" commit`, `git add -A && git commit` —
// but not `git commit-tree`, `git log --grep=commit` or a sha passed to `git show`.
const COMMIT_PATTERN = /\bgit(?:\s+-\S+(?:\s+(?:"[^"]*"|'[^']*'|[^\s-]\S*))?)*\s+commit(?![\w-])/;

const PASSED_FLAG = "--passed";

// Not tmpdir(): the hook runs outside Claude Code's sandbox and the `--passed` command
// inside it, and the sandbox gives its commands a temp directory of their own.
const MARKER_DIR = fileURLToPath(
  new URL("../../node_modules/.cache/tomtom-mcp-preflight/", import.meta.url)
);

const markerPath = (sessionKey) => join(MARKER_DIR, sessionKey.replace(/[^\w-]/g, ""));

function denialReason(sessionKey) {
  const recordPassCommand = `node "${fileURLToPath(import.meta.url)}" ${PASSED_FLAG} ${sessionKey}`;
  return (
    "This repository has no git hooks, so preflight is the only gate before CI. Run the " +
    "tomtom-mcp-preflight skill's commit tier; when its verdict is ready to commit, record " +
    `the pass with \`${recordPassCommand}\` and re-run this command. If the user asked to ` +
    "commit without preflight, record the pass and re-run — the gate stays open for the rest " +
    "of this session."
  );
}

async function readStdin() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  return payload;
}

function parseHookInput(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function recordPass(sessionKey) {
  if (!sessionKey) {
    console.error(`Usage: node preflight-gate.mjs ${PASSED_FLAG} <session id from the denial>`);
    process.exit(1);
  }
  mkdirSync(MARKER_DIR, { recursive: true });
  writeFileSync(markerPath(sessionKey), "");
  console.log("Preflight pass recorded: git commit is open for the rest of this session.");
}

async function gate() {
  const input = parseHookInput(await readStdin());
  const isClaudeCode = input.tool_input !== undefined;
  const command = (isClaudeCode ? input.tool_input.command : input.command) ?? "";
  // Claude Code and Cursor always send an id; the date stops a payload without one
  // from sharing a single marker with every later session on the machine.
  const sessionKey =
    input.session_id ?? input.conversation_id ?? `unknown-${new Date().toISOString().slice(0, 10)}`;

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
}

if (process.argv[2] === PASSED_FLAG) {
  recordPass(process.argv[3]);
} else {
  await gate();
}
