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
 * ---------------------------------------------------------------------------
 * VENDORED from the agent toolkit's
 * `plugins/agent-toolkit/src/tools/shared/sandbox-code.ts`.
 *
 * The proposal (§2.7) recommended consuming this via a `"./sandbox"` subpath
 * export on `@tomtom-org/maps-sdk-plugin-agent-toolkit` instead of copying it.
 * That is still the right end state, and it is NOT done here for two reasons:
 * adding a public subpath export is a change to a different repository's API
 * surface, and the toolkit is not currently a dependency of this one (its `.`
 * entrypoint reaches `create-map-agent` → `ai` → `maplibre-gl`, none of which
 * belong in an MCP server).
 *
 * So: vendored, with the seams kept identical so the swap is a delete-and-import
 * when that export lands. Everything below keeps the toolkit's exported names
 * and contracts. What was dropped: the iframe-worker executor (browser-only) and
 * `routeUtils` (a maps-sdk/map import). What was added: nothing — the Node
 * worker executor lives in `worker-executor.ts` beside this file.
 *
 * If you change behaviour here, note it in this header so the divergence from
 * upstream is visible.
 * ---------------------------------------------------------------------------
 */

/** Chart.js chart types accepted when `outputFormat: "chart"`. */
export const CHART_TYPES = new Set([
  "bar",
  "line",
  "pie",
  "doughnut",
  "radar",
  "polarArea",
  "scatter",
  "bubble",
]);

export type AnalysisOutputFormat = "json" | "chart";

/** Lightweight structural check that a sandbox return value is a Chart.js config. */
export const isChartConfiguration = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; data?: unknown };
  return (
    typeof v.type === "string" &&
    CHART_TYPES.has(v.type) &&
    typeof v.data === "object" &&
    v.data !== null
  );
};

/**
 * Globals shadowed to `undefined` inside every sandbox body.
 *
 * LLM-authored code has no legitimate need for network / storage / global
 * reaches: its data is injected and its libraries are injected. Binding these as
 * `undefined` parameters turns a stray `fetch(...)` into a loud
 * "fetch is not a function" instead of a silent exfiltration.
 *
 * This is a TRIPWIRE, not a security boundary — the same capabilities stay
 * reachable through constructor walks (`({}).constructor.constructor`). On a
 * multi-tenant server the actual boundary is the worker thread
 * (`worker-executor.ts`); this layer only surfaces accidents.
 *
 * `process` matters most: it is a direct global in Node and the first hop toward
 * `child_process`.
 */
const SHADOWED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document",
  "window",
  "globalThis",
  "self",
  "navigator",
  "importScripts",
  "process",
  "require",
  "module",
  "__dirname",
  "__filename",
] as const;

/** Exported so any executor can apply the same shadowing inside its own realm. */
export const sandboxedGlobalShadows = SHADOWED_GLOBALS;

/**
 * Pluggable strategy for executing sandbox code.
 *
 * `run` MUST resolve to `{ value }` or `{ error }` and never reject — execution
 * failures are reported as `{ error }` via {@link formatSandboxExecutionError}.
 */
export type SandboxExecutor = {
  run<Result = unknown>(
    code: string,
    paramNames: readonly string[],
    args: readonly unknown[],
    verb: string
  ): Promise<{ value: Result } | { error: string }>;
  /** Release held resources. No-op for the main-thread executor. */
  destroy?(): void;
};

/**
 * Compiles `code` as an async-function body taking `paramNames`, runs it with
 * `args`, and returns `{ value }` or `{ error }`.
 *
 * Sanitising happens HERE, once, before dispatch, so every executor runs
 * identically de-fanged code.
 */
export const runSandboxedFn = <Result = unknown>(
  code: string,
  paramNames: readonly string[],
  args: readonly unknown[],
  verb: string,
  executor: SandboxExecutor
): Promise<{ value: Result } | { error: string }> =>
  executor.run<Result>(stripInjectedRedeclarations(code, paramNames), paramNames, args, verb);

/**
 * Strips redeclarations of injected identifiers.
 *
 * LLMs regularly prepend `const turf = require('@turf/turf')` out of habit,
 * which is a parse-time "Identifier 'turf' has already been declared" before the
 * body even runs. Only `require(...)` / `import(...)` / `arguments.x` right-hand
 * sides are stripped: a name-only filter would also nuke a legitimate user
 * variable that happens to share a name, corrupting the body and producing a far
 * less actionable error.
 */
export const stripInjectedRedeclarations = (
  code: string,
  identifiers: readonly string[]
): string => {
  const names = identifiers.join("|");
  const rhs =
    String.raw`(?:(?:await\s+)?(?:require|import)\s*\(` +
    String.raw`|arguments\s*(?:\[\s*\d+\s*\])?\s*(?:\.\w+|\[\s*['"]\w+['"]\s*\]))`;
  const pattern = new RegExp(
    String.raw`^[ \t]*(?:const|let|var)[ \t]+(?:${names})[ \t]*=[ \t]*${rhs}[^\n]*\n?`,
    "gm"
  );
  return code.replace(pattern, "");
};

/**
 * Normalises a sandbox return value to something JSON-safe.
 *
 * A JSON round-trip, NOT `structuredClone`: this must COERCE (drop `undefined`,
 * `NaN`/`Infinity` → `null`, Date → ISO string, throw on circular). A faithful
 * clone would preserve non-JSON values that then poison the tool response.
 */
const toJsonSafe = (value: unknown): { value: unknown } | { error: string } => {
  try {
    return { value: JSON.parse(JSON.stringify(value)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error:
        `Returned value is not JSON-serializable: ${message}. ` +
        "Return only plain objects, arrays, strings, numbers, booleans, and null — " +
        "no functions, classes, circular references, or Map/Set instances.",
    };
  }
};

/** Validates the value returned by sandboxed analysis code. */
export const validateAnalysisResult = (
  analysis: unknown,
  outputFormat: AnalysisOutputFormat
): { value: unknown } | { error: string } => {
  if (analysis === undefined) {
    return {
      error:
        "Analysis code must return a value (the aggregation result). " +
        "Hint: `code` is the function BODY, not a function expression. If you wrote " +
        "`(args) => { ...; return result; }` as the whole code, the arrow is created and " +
        "discarded — drop the wrapper and have the body itself end with `return result;`.",
    };
  }

  const normalized = toJsonSafe(analysis);
  if ("error" in normalized) return { error: normalized.error };

  if (outputFormat === "chart" && !isChartConfiguration(normalized.value)) {
    return {
      error:
        'Analysis code with `outputFormat: "chart"` must return a Chart.js ChartConfiguration ' +
        '({ type: "bar"|"line"|"pie"|"doughnut"|"radar"|"polarArea"|"scatter"|"bubble", ' +
        "data: { labels, datasets }, options? }).",
    };
  }

  return { value: normalized.value };
};

/**
 * Hints appended to LLM-facing error strings when the runtime message matches a
 * known pitfall, so the model can self-correct instead of guessing.
 *
 * Order matters — library-specific rules come before the generic
 * `is not a function` so callers get the targeted redirect.
 */
const SANDBOX_ERROR_HINTS: ReadonlyArray<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /Cannot read propert(?:y|ies) of undefined/i,
    hint: "A property was read on `undefined`. Likely a `reduce` callback that does not `return` the accumulator, or a `reduce` without an initial value — use `arr.reduce((acc, x) => { ...; return acc; }, {})`. Also check unguarded chains like `feature.properties.poi.categories` — use `?.` and `??`. Call tomtom-describe-dataset to see which paths actually exist.",
  },
  {
    pattern: /Cannot read propert(?:y|ies) of null/i,
    hint: "A property was read on `null`. Guard with `?.` and default with `??`.",
  },
  {
    pattern: /\bh3\.\w+ is not a function/i,
    hint: "`h3` is h3-js — hex-grid math only. NO spatial search, place lookup, or HTTP. Common: `latLngToCell`, `cellToLatLng`, `cellToBoundary`, `polygonToCells`, `gridDisk`, `cellArea`.",
  },
  {
    pattern: /\bturf\.\w+ is not a function/i,
    hint: "`turf` is @turf/turf v7 — GeoJSON geometry only. NO spatial search or HTTP. Common: `area`, `length`, `bbox`, `centroid`, `union`, `intersect`, `buffer`, `distance`, `booleanPointInPolygon`, `pointsWithinPolygon`, `clustersDbscan`. Verify names at https://turfjs.org/docs/.",
  },
  {
    pattern: /coordinates must be an Array|Unknown Geometry Type/i,
    hint: "turf was handed a raw coordinate (or a bare Array of features) instead of a Feature / FeatureCollection. Do NOT extract `.geometry.coordinates` and feed that to turf — pass the WHOLE feature. To span a collection, wrap: `turf.bbox(turf.featureCollection(features))`.",
  },
  {
    pattern: /coord must be (?:a )?(?:GeoJSON )?Point|must be a Point/i,
    hint: 'A point-only turf op was handed a non-Point feature. Datasets mix Point / LineString / Polygon geometries. Use `turf.booleanIntersects(feature, polygon)` for any geometry type, or guard with `if (f.geometry.type === "Point")`, or reduce to a point first with `turf.pointOnFeature(f)`.',
  },
  {
    pattern: /is not a function/i,
    hint: "A method was called on a value that does not have it (typo, or the value is not the expected type). Verify first, e.g. `Array.isArray(x) ? x.map(...) : []`.",
  },
  {
    pattern: /Illegal return statement/i,
    hint: "A `return` sits outside the top-level function body — usually a missing brace, or a multi-line callback whose closing `})` was lost. Re-emit with balanced braces and `return` only at the top level.",
  },
  {
    pattern: /Identifier ['"]?\w+['"]? has already been declared/i,
    hint: "A variable was declared twice — typically `const turf = require(...)` or `const datasets = ...`. Those names are already function parameters; drop the redeclaration and use them directly.",
  },
  {
    pattern: /Unexpected (?:token|identifier|end of input)/i,
    hint: "The code did not parse as an async-function body. Common causes: unbalanced braces/parens, a stray template literal, or `import`/`export` statements (not allowed — `datasets`, `turf` and `h3` are already in scope). Re-emit a self-contained body ending in `return ...;`.",
  },
  {
    pattern: /\brequire is not defined\b|\bimport (?:is not defined|outside a module)\b/i,
    hint: "The sandbox is not a module — `require` and top-level `import` are unavailable. The libraries (`turf`, `h3`) and your data are already injected as parameters.",
  },
  {
    pattern: /\b(?:fetch|XMLHttpRequest|process|globalThis) is not (?:a function|defined)\b/i,
    hint: "Network, filesystem and process access are blocked by design. The sandbox works only on the datasets passed in. To bring in more data, call the search/routing tool first and pass its dataset_id.",
  },
  {
    pattern: /\b(?:functions|tools|agent)\b.*is not defined/i,
    hint: "The sandbox cannot call other tools. List every dataset you need in `dataset_ids` — each arrives in `datasets`, keyed by id.",
  },
  {
    pattern: /is not iterable/i,
    hint: "A value used in `for..of`, spread, or destructuring was not iterable. Default arrays with `?? []`.",
  },
  {
    pattern: /Cannot access '.+?' before initialization/i,
    hint: "A `let`/`const` was used before its declaration. Move the declaration above its first use.",
  },
  {
    pattern: /Assignment to constant variable/i,
    hint: "A `const` was reassigned. Use `let`, or mutate in place.",
  },
  {
    pattern: /could not be cloned|DataCloneError/i,
    hint: "The return value must be pure JSON — no functions, classes, Maps or Sets. It crosses a worker boundary before reaching you.",
  },
];

/**
 * Builds an LLM-facing error string for a sandbox failure, appending a `Hint:`
 * when the message matches a known pattern.
 */
export const formatSandboxExecutionError = (verb: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const base = `${verb} code execution failed: ${message}`;
  const match = SANDBOX_ERROR_HINTS.find(({ pattern }) => pattern.test(message));
  if (match) return `${base} Hint: ${match.hint}`;
  if (error instanceof Error && error.name === "SyntaxError") {
    return `${base} Hint: the provided \`code\` is not valid JavaScript — ensure it parses as an async function body and \`return\`s a value.`;
  }
  return base;
};
