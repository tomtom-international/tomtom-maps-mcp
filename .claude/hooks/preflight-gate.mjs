/**
 * Shell-command gate: bounce the first `git commit` of an agent session so the
 * tomtom-mcp-preflight skill runs before anything reaches CI.
 *
 * There are no git hooks in this repository, so a commit is otherwise ungated.
 * The bounce fires ONCE per session — the marker is written before the denial is
 * emitted, so an immediate retry always succeeds and the gate can never deadlock
 * a contributor who deliberately skips preflight.
 *
 * Wired as a Claude Code PreToolUse(Bash) hook from .claude/settings.json and as
 * a Cursor beforeShellExecution hook from .cursor/hooks.json; the payload shape
 * tells the two apart.
 */
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `git commit`, `git -C <dir> commit`, `git add -A && git commit` — but not
// `git log --grep=commit` or a sha passed to `git show`.
const COMMIT_PATTERN = /git( +-[^ ]+( +[^ ]+)?)* +commit\b/;

const REASON =
  "This repository has no git hooks, so preflight is the only gate before CI. Run the " +
  "tomtom-mcp-preflight skill, then re-run this command. If the user asked to commit " +
  "without it, re-run the command as-is — this gate fires only once per session.";

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

const input = parseHookInput(await readStdin());
const isClaudeCode = input.tool_input !== undefined;
const command = (isClaudeCode ? input.tool_input.command : input.command) ?? "";
const sessionId = input.session_id ?? input.conversation_id ?? "unknown";

const denial = isClaudeCode
  ? {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: REASON,
      },
    }
  : { permission: "deny", user_message: REASON, agent_message: REASON };

const marker = join(tmpdir(), `tomtom-mcp-preflight-${sessionId}`);

if (COMMIT_PATTERN.test(command) && !existsSync(marker)) {
  writeFileSync(marker, "");
  console.log(JSON.stringify(denial));
} else if (!isClaudeCode) {
  // Cursor expects a decision on stdout; Claude Code treats silence as "proceed".
  console.log(JSON.stringify({ permission: "allow" }));
}
