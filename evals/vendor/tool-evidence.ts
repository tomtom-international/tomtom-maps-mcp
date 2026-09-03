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
 * PORTED from the maps-sdk-js agent-eval framework:
 *   agent-eval/src/judge/toolEvidence.ts
 *
 * Kept deliberately close to the original — same function names, same constants,
 * same semantics — so that when `agent-eval` becomes a published library this
 * file is deleted and the import redirected, rather than reconciled.
 *
 * Why port rather than reinvent: this repo grew its own version of the same
 * thing and got it wrong twice. First by slicing the serialised JSON at 6,000
 * characters, which cut mid-token and handed the judge malformed text it then
 * scored as fabrication; then by abridging inside the budget, which invented
 * omissions the data did not have. The toolkit's version had already solved both
 * — its own comment says as much: "We do not slice by length as we can cut a
 * key… Otherwise, we collapse early, and grounding pipeline flags all these
 * claims as ungrounded." That is the exact bug, written down before we hit it.
 *
 * Local additions are marked TOMTOM-MCP and kept to a minimum:
 *   • `compactionStats` — whether anything collapsed, so a grounding verdict can
 *     record what it was formed over. The original does not need this because it
 *     does not report per-task completeness; we do.
 */

import type { ToolCall } from "./types";

// Tool-value compaction tuning. The DEFAULTS are the original's, unchanged.
export interface CompactionOptions {
  /** Object arrays this short are shown whole; longer ones collapse to {count, sample}. */
  smallArrayMax?: number;
  /** Scalar arrays (chart series, hourly/daily buckets, labels) stay whole up to here. */
  scalarArrayMax?: number;
  /** Sample items kept alongside the count when a bulk array collapses. */
  sampleSize?: number;
  /** Long free-text fields are capped; scalars never are. */
  stringCharLimit?: number;
  maxDepth?: number;
}

export const COMPACTION_DEFAULTS: Required<CompactionOptions> = {
  smallArrayMax: 8,
  scalarArrayMax: 64,
  sampleSize: 2,
  stringCharLimit: 500,
  maxDepth: 6,
};

export type ToolStatus = "ok" | "empty" | "failed";

/**
 * Deterministic OUTPUT classification: failed (errored), empty (ran, no
 * records), ok (produced data). Used to check ungrounded claims.
 */
export const classifyToolCall = (toolCall: ToolCall): ToolStatus => {
  const output = toolCall.output;

  if (output && typeof output === "object") {
    if ("error" in output) return "failed";
    const record = output as { count?: unknown; features?: unknown; entries?: unknown };
    if (record.count === 0) return "empty";
    if (Array.isArray(record.features) && record.features.length === 0) return "empty";
    if (Array.isArray(record.entries) && record.entries.length === 0) return "empty";
  }
  return "ok";
};

/** TOMTOM-MCP: what a compaction pass had to give up. */
export interface CompactionStats {
  collapsedArrays: number;
  truncatedStrings: number;
  omittedItems: number;
}

/**
 * Standardises a tool value into a fixed shape.
 *
 * We do not slice by length as we can cut a key. We only collapse large arrays
 * into smaller units to guide the LLM better. We do not drop fields — every key
 * is kept — but bulk arrays collapse to {count, sample}, which is enough to
 * verify aggregate claims ("203 incidents") while staying small.
 */
const compactToolValue = (
  value: unknown,
  stats: CompactionStats,
  options: Required<CompactionOptions>,
  depth = 0
): unknown => {
  // Cap over-long free text; shorter strings and all other scalars pass through.
  if (typeof value === "string") {
    if (value.length <= options.stringCharLimit) return value;
    stats.truncatedStrings += 1;
    return `${value.slice(0, options.stringCharLimit)}… [+${value.length - options.stringCharLimit} chars]`;
  }

  if (value === null || typeof value !== "object") return value;
  if (depth >= options.maxDepth) return "[nested]";

  // Keep short arrays, collapse big ones so they do not flood the context.
  // Scalar arrays survive longer: timeseries and buckets are the evidence for
  // numeric claims, and collapsing them early makes those claims ungroundable.
  if (Array.isArray(value)) {
    const allScalar = value.every((item) => item === null || typeof item !== "object");
    const cap = allScalar ? options.scalarArrayMax : options.smallArrayMax;
    if (value.length <= cap) {
      return value.map((item) => compactToolValue(item, stats, options, depth + 1));
    }
    const sample = value
      .slice(0, options.sampleSize)
      .map((item) => compactToolValue(item, stats, options, depth + 1));
    stats.collapsedArrays += 1;
    stats.omittedItems += value.length - options.sampleSize;
    return { count: value.length, sample };
  }

  // Plain object: keep every key, recursing so nested strings/arrays compact too.
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [
      key,
      compactToolValue(val, stats, options, depth + 1),
    ])
  );
};

/**
 * Renders a tool value as JSON text — 'none' for absent input/output, String()
 * fallback so a circular value cannot crash the judgement.
 */
export const convertToJsonString = (value: unknown, options?: CompactionOptions): string =>
  convertToEvidence(value, options).text;

/**
 * TOMTOM-MCP: the same conversion, with what it had to give up, and with the
 * caps exposed.
 *
 * The caps are tuning, not design, and the right values depend on what the
 * corpus asks. The toolkit's agent is asked for summaries, so eight object
 * entries is plenty. Several tasks here ask for a SPECIFIC entity out of a large
 * list — "the single worst traffic incident in Amsterdam" — and with the default
 * cap the judge sees {count: 226, sample: [2]} and rules a correctly-quoted
 * incident invented, because it genuinely cannot see it. Observed, not feared.
 */
export const convertToEvidence = (
  value: unknown,
  options?: CompactionOptions
): { text: string; stats: CompactionStats } => {
  const resolved = { ...COMPACTION_DEFAULTS, ...options };
  const stats: CompactionStats = { collapsedArrays: 0, truncatedStrings: 0, omittedItems: 0 };
  if (value === undefined) return { text: "none", stats };
  try {
    return { text: JSON.stringify(compactToolValue(value, stats, resolved)), stats };
  } catch {
    return { text: String(value), stats };
  }
};
