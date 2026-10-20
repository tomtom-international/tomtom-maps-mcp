/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  APP_DATA_META_KEY,
  type APP_DATA_FETCH_REASONS,
  type APP_DATA_SOURCES,
  type APP_STATUSES,
} from "../../constants";

type Source = (typeof APP_DATA_SOURCES)[number];
type FetchReason = (typeof APP_DATA_FETCH_REASONS)[number];
type Status = (typeof APP_STATUSES)[number];

/** The data an app draws (CONTEXT.md, App data), and the server's record of how that went. */
export interface AppDataTracker {
  /**
   * The full data for this tool result, from the first of these that has it:
   * - the result's `_meta`, where the server inlines it;
   * - the tool named in the text's `_meta.tool`, run again on the server with this call's input;
   * - without a tool there, the response itself, which is the full data under response_detail "full".
   *
   * @throws {Error} When the data must be fetched and the fetch fails.
   */
  load<T>(result: Pick<CallToolResult, "_meta">, agentResponse: unknown): Promise<T>;
  /** Tells the server the app drew, from `source` when it drew without `load`. */
  drawn(source?: Source): void;
  /** Tells the server the app could not draw. */
  failed(error: unknown): void;
}

/** `defaultTool` names the tool for an app that draws without `load`. */
export function trackAppData(app: App, defaultTool?: string): AppDataTracker {
  let input: Record<string, unknown> | undefined;
  let tool = defaultTool;
  let source: Source | undefined;
  let loading = false;
  let started = performance.now();
  app.addEventListener("toolinput", (params) => {
    input = params.arguments;
    started = performance.now();
  });

  const report = (status: Status, fields: Record<string, unknown> = {}) => {
    const args = {
      tool,
      status,
      source,
      duration_ms: Math.round(performance.now() - started),
      ...fields,
    };
    app.callServerTool({ name: "tomtom-report-app-status", arguments: args }).catch(() => {});
    app
      .sendLog({ level: status === "failed" ? "error" : "info", logger: "tomtom-app", data: args })
      .catch(() => {});
  };

  return {
    async load<T>(result: Pick<CallToolResult, "_meta">, agentResponse: unknown) {
      const named = (agentResponse as { _meta?: { tool?: unknown } } | null)?._meta?.tool;
      const rerun = typeof named === "string" ? named : undefined;
      tool = rerun ?? defaultTool;
      loading = true;
      let reason: FetchReason = "not_inline";
      const inline = result._meta?.[APP_DATA_META_KEY];
      if (typeof inline === "string") {
        try {
          const data = (await decodeInline(inline)) as T;
          source = "inline";
          loading = false;
          return data;
        } catch (error) {
          console.error("Failed to decode the inline app data:", error);
          reason = "decode_failed";
        }
      }
      if (!rerun) {
        source = "response";
        loading = false;
        return agentResponse as T;
      }
      const data = (await fetchAppData(app, rerun, input ?? {}, reason)) as T;
      source = "fetched";
      loading = false;
      return data;
    },
    drawn(drawnFrom) {
      source = drawnFrom ?? source;
      report("drawn");
    },
    failed(error) {
      const message = error instanceof Error ? error.message : String(error);
      report("failed", { stage: loading ? "data" : "draw", error: message.slice(0, 300) });
      loading = false;
    },
  };
}

async function fetchAppData(
  app: App,
  tool: string,
  args: Record<string, unknown>,
  reason: FetchReason
): Promise<unknown> {
  const result = await app.callServerTool({
    name: "tomtom-get-app-data",
    arguments: { tool, arguments: args, reason },
  });
  const [content] = result.content ?? [];
  if (result.isError || content?.type !== "text") {
    throw new Error(`Failed to fetch the app data of ${tool}`);
  }
  return JSON.parse(content.text);
}

/** The data the server inlined: base64 of its gzipped JSON. */
async function decodeInline(encoded: string): Promise<unknown> {
  const gzipped = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const json = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(json).text());
}
