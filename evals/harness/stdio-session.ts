/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Real-transport tool source: spawns `bin/tomtom-mcp.js` and drives it through
 * the MCP SDK client, exactly as a real client would.
 *
 * Why this exists. The in-process source in `mcp-agent.ts` reads tools straight
 * off `TOOL_REGISTRY`, which is faithful for descriptions and schemas but skips
 * the whole MCP boundary: JSON-Schema conversion of the Zod shapes, argument
 * coercion on the way in, and the `{ content: [{ type: "text", text }] }`
 * envelope on the way out. Until now nothing exercised LLM + real serialization —
 * `tests/test-stdio-tools.js` drives the transport with no model, and the
 * in-process evals drive the model with no transport. This closes that gap.
 *
 * It is opt-in (`EVAL_TRANSPORT=stdio`) because it needs a BUILT `dist/`, and a
 * stale build silently evaluates yesterday's tool surface — see the freshness
 * check below.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, type ToolSet, tool } from "ai";
import type { ToolCall } from "../vendor/types";
import { type EvalTarget, TARGET } from "./target";

/** A tool as the MCP server advertises it over the wire. */
interface ListedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  _meta?: { ui?: { visibility?: string[] } };
}

/**
 * Fails loudly when the target's `dist/` is missing or older than its `src/`.
 *
 * A stale bundle is the dangerous case: everything runs, and you get a clean
 * report describing a tool surface that no longer exists. Cheap `git`-free
 * check — newest mtime under `src/` vs. the bundle's.
 *
 * It matters more for a baseline than for this tree, not less: a baseline
 * checkout is built once and then forgotten, so an unbuilt one would otherwise
 * fail as an opaque handshake error and an out-of-date one would silently score
 * the wrong surface. The message therefore names the checkout it is complaining
 * about, since the fix is `pnpm build` in a directory you may not be standing in.
 */
function assertFreshBuild(target: EvalTarget): void {
  const bundle = join(target.root, "dist", "index.esm.js");
  const where = target.isBaseline ? ` in ${target.root}` : "";

  if (!existsSync(bundle)) {
    throw new Error(
      `EVAL_TRANSPORT=stdio needs a built server, but ${bundle} is missing. ` +
        `Run \`pnpm build\`${where} first.`
    );
  }

  // `find -newer` is the cheapest portable "is anything in src newer than X".
  const newer = spawnSync("find", ["src", "-name", "*.ts", "-newer", bundle], {
    cwd: target.root,
    encoding: "utf-8",
  });
  const stale = (newer.stdout ?? "").trim().split("\n").filter(Boolean);
  if (stale.length) {
    throw new Error(
      `dist/ is older than ${stale.length} source file(s) (e.g. ${stale[0]})${where}. ` +
        `The transport evals would score a stale tool surface — run \`pnpm build\`${where} first.`
    );
  }
}

export interface StdioSession {
  /** The tool names the server actually advertises to a non-app client. */
  readonly toolNames: readonly string[];
  /** Which checkout answered — carried into the report so a run is attributable. */
  readonly target: EvalTarget;
  /** AI SDK tools backed by real `callTool` round-trips. */
  buildTools(calls: ToolCall[]): ToolSet;
  close(): Promise<void>;
}

/**
 * Opens one MCP session against a freshly spawned server.
 *
 * The session is opened ONCE per suite rather than per task: spawning a Node
 * process and re-reading every app resource for each of 13 tasks would dominate
 * the wall clock and tell us nothing extra.
 *
 * `target` selects the checkout. It defaults to this working tree; pass a
 * baseline (via `EVAL_SERVER_ROOT`) to drive an older tool surface through the
 * identical client. Everything downstream — the agent loop, the corpus, the
 * judge — is unchanged, which is what makes the two reports comparable.
 */
export async function openStdioSession(target: EvalTarget = TARGET): Promise<StdioSession> {
  assertFreshBuild(target);

  const client = new McpClient({ name: "tomtom-mcp-evals", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [join(target.root, "bin", "tomtom-mcp.js")],
    // Deliberately NOT `cwd: target.root`: the server loads its TOMTOM_API_KEY
    // from the `.env` of its working directory, and a baseline worktree has no
    // `.env` (it is untracked). Keeping this process's cwd means both servers
    // authenticate from the same file, so a credential difference can never be
    // mistaken for a capability difference.
    env: { ...process.env } as Record<string, string>,
  });
  await client.connect(transport);

  const listed = (await client.listTools()).tools as unknown as ListedTool[];

  // App-internal tools are plumbing for the MCP app; a model must never see
  // them. Filtering here mirrors what a real client does with the visibility
  // hint — and `transport.test.ts` asserts the surface matches DEFAULT_TOOLS.
  const agentTools = listed.filter((t) => !t._meta?.ui?.visibility?.includes("app"));

  return {
    toolNames: agentTools.map((t) => t.name),
    target,

    buildTools(calls: ToolCall[]): ToolSet {
      return Object.fromEntries(
        agentTools.map((listedTool) => [
          listedTool.name,
          tool({
            description: listedTool.description ?? "",
            // The server's own JSON Schema, not a re-derivation from the Zod
            // shape — that difference is precisely what this mode tests.
            inputSchema: jsonSchema(listedTool.inputSchema as never),
            execute: async (input: unknown) => {
              const result = await client.callTool({
                name: listedTool.name,
                arguments: input as Record<string, unknown>,
              });
              const text = ((result.content ?? []) as { type: string; text?: string }[])
                .filter((part) => part.type === "text")
                .map((part) => part.text ?? "")
                .join("\n");
              let output: unknown;
              try {
                output = JSON.parse(text);
              } catch {
                output = text;
              }
              calls.push({ name: listedTool.name, input, output });
              return output;
            },
          }),
        ])
      ) as ToolSet;
    },

    async close() {
      await client.close();
    },
  };
}
