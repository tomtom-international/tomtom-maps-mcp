# Adding new tools to TomTom Maps MCP

How to add a **tool** (an API integration the model can call) and, optionally, the
**MCP app** that visualises its result.

Read [`docs/tools-architecture.md`](./docs/tools-architecture.md) first if you
haven't — especially *"Two audiences, one tool"*. Most of the steps below only make
sense once you know that a tool serves the model and the app differently.

The short version: **a tool is a row in `src/tools/tool-registry.ts`.** Everything
else exists to fill that row in.

---

## 1. Gather the API details

* Base URL and endpoints — and check whether `@tomtom-org/maps-sdk` already covers
  it. Prefer the SDK; raw REST means another axios consumer, and we are down to one
  (`services/traffic/traffic-rest.ts`).
* Auth, methods, query/path parameters.
* Request/response payloads — get a **real** response, not just the docs. You need
  to know what is verbose enough to trim.
* Rate limits, quotas, timeouts, error format.

---

## 2. Service layer — `src/services/<domain>/`

Talks to the API. Nothing about MCP belongs here.

```
src/services/elevation/
├── elevationService.ts
├── types.ts
└── elevationService.test.ts
```

* Resolve the key with `requireApiKey()` from `services/api-key.ts` — don't
  re-roll the `getEffectiveApiKey()` + throw preamble.
* Build optional params with `compact()` / `nonEmpty()` from `services/params.ts`
  rather than `if (x !== undefined) params.x = x` ladders.
* Return the API response **untrimmed**. Trimming is a tool-layer concern, and the
  app needs the full payload.

---

## 3. Input schema — `src/schemas/<domain>/`

Export a **Zod raw shape** (a plain object of Zod validators, not a `z.object`) —
that is what `registerTool` takes.

```ts
export const tomtomElevationSchema = {
  positions: z.array(z.tuple([z.number(), z.number()]))
    .describe("Points as [longitude, latitude] (GeoJSON order)"),
  ...uiVisibilityParam,     // show_ui — include if the tool has an app
  response_detail: responseDetailSchema,
};
export type ElevationParams = z.input<z.ZodObject<typeof tomtomElevationSchema>>;
```

Every `.describe()` is read by the model. Say the units and the coordinate order;
`[lon, lat]` vs `[lat, lon]` is the single most common model error here.

---

## 4. Handler — `src/tools/services/<domain>.ts`

Use `defineDataTool`. Supply only `execute` and `project`:

```ts
export const elevationHandler = defineDataTool<ElevationParams, unknown>({
  verb: "Elevation lookup",                       // log + error prefix
  execute: ({ positions, ...options }) => getElevation(positions, options),
  project: trimElevationResponse,                 // what the model sees
});
```

The pipeline handles stripping `show_ui` / `response_detail`, the `full` escape
hatch, caching the full payload for the app, and `handleApiError`. Optional hooks:
`validate` (reject before spending a request), `pretty: false` (compact JSON for
high-cardinality results), `logResult`.

Put `project` in `src/tools/shared/response-trimmer.ts` with the other
projections — that module is deleted wholesale in phase 2, and scattering trims
across handlers is what phase 0 undid.

Only hand-write a handler if the tool genuinely doesn't fit — no upstream call, or
a response shape that isn't "summary + cached payload". Say why in a comment, as
`dataVizHandler` and `dynamicMapHandler` do.

---

## 5. Register it — one row in `src/tools/tool-registry.ts`

```ts
{
  name: "tomtom-elevation",
  title: "TomTom Elevation",
  description:
    "Look up ground elevation in metres for one or more coordinates. " +
    "Use when the user asks about height, altitude, or terrain at a point. " +
    "Do NOT use for route gradients — use tomtom-routing.",
  inputSchema: tomtomElevationSchema,
  handler: elevationHandler,
  kind: "places",
  app: app("tomtom-elevation", "elevation", "elevation-profile"),  // omit if no app
  tags: ["location"],
  examplePrompts: [
    "How high above sea level is Mont Blanc?",
    "What's the elevation at 52.379, 4.899?",
  ],
  relatedTools: ["tomtom-routing"],
}
```

Nothing else to touch. `register.ts` picks the row up, applies
`READ_ONLY_ANNOTATIONS`, and registers the app resource if `app` is set. Do **not**
add a `registerAppTool` call — there is exactly one in the codebase.

### The description is the feature

Tool selection is decided almost entirely here. What works:

* Lead with what it does, in the user's words.
* Name the tools it is confusable with, and say when to use them instead — every
  existing near-miss pair does this (`nearby` vs `area-search`, `routing` vs
  `reachable-range`, `dynamic-map` vs `data-viz`).
* Encode ordering constraints explicitly, and mirror them in `dependsOn`
  (`tomtom-poi-categories` says "REQUIRED before using poiCategories").

`tags` must come from `src/tools/tool-tags.ts` (shared vocabulary with the agent
toolkit); `relatedTools` / `dependsOn` must name real tools. Both are asserted.

### `examplePrompts` are tests, not decoration

`evals/scenarios/` reads them via `getDefaultToolPrompts()`. The **first** prompt
becomes the always-on canonical selection test; the rest run under
`SCENARIOS_FULL=1`. A tool with none fails `tool-registry.test.ts`.

Write prompts a user would actually type — including a misspelling or a vague one,
since that is what the description has to survive.

---

## 6. MCP app (optional) — `src/apps/<category>/<appName>/`

Only if the result is worth *drawing*. See the sequence diagram in
[`docs/tools-architecture.md`](./docs/tools-architecture.md#the-full-round-trip)
for the data flow.

1. Create `src/apps/<category>/<appName>/` with `app.ts` + `index.html`. Copy the
   closest sibling; `src/apps/shared/` has the API key, map controls, POI popups.
2. Get the full data with `extractFullData(app, agentResponse)` from
   `apps/shared/decompress.ts` — it redeems `_meta.dataset_id` via the app-only
   `tomtom-get-dataset`, with a `localStorage` fallback for when the 30-minute
   server-side dataset has expired.
3. Point the registry row's `app` at it. `category`/`appName` must match the
   directory names — they locate the built HTML, and a mismatch renders an
   "App not found" placeholder instead of failing loudly.
4. `pnpm build:apps` (or `pnpm build:apps:<category>`).

Include `...uiVisibilityParam` in the schema so the model can pass `show_ui`.
Without an app, skip `app` **and** `show_ui` — `tomtom-poi-categories` has an app
but no `show_ui`, because its result is a lookup table.

> An app directory that no registry row references still gets built, silently, on
> every build — nothing warns you. `src/apps/routing/waypoint-routing/` sat that
> way for months after its tool was merged into `tomtom-routing`. If you retire a
> tool, delete its app directory in the same commit.

---

## 7. Tests

| Test | Where |
| --- | --- |
| Service against the real API | `src/services/<domain>/*.test.ts` |
| `execute` / `project` with the service mocked | `src/tools/services/<domain>.test.ts` |
| Registry invariants, registration, boot | already generic — your row is covered automatically |
| Tool selection | add `examplePrompts` (step 5); no test file needed |

```bash
pnpm type-check && pnpm test && pnpm check
```

If the tool unlocks a question that was previously unanswerable, add a task to
`evals/capability/tasks.ts` — `expected: "pass"` if it works now, `expected:
"blocked"` with a `blockedBy` reason if the data is still being trimmed away.

---

## 8. Document it

* Add a row to **Available Tools** in [`README.md`](./README.md), with a docs link.
* Add it to the tool-surface table in
  [`docs/tools-architecture.md`](./docs/tools-architecture.md#the-tool-surface).
* A `docs/<tool>.md` page only if it has real setup or quirks.

---

## Checklist

* [ ] SDK checked before reaching for raw REST
* [ ] Service returns the **untrimmed** response; uses `requireApiKey()` + `compact()`
* [ ] Schema is a Zod raw shape; every `.describe()` states units and coordinate order
* [ ] Handler via `defineDataTool`; projection lives in `response-trimmer.ts`
* [ ] One registry row — no new `registerAppTool` call
* [ ] Description names the tools it is confusable with
* [ ] `examplePrompts` present; `tags` from `tool-tags.ts`; `relatedTools` / `dependsOn` resolve
* [ ] App wired via `app` **and** built, or omitted entirely (no orphan directory)
* [ ] `pnpm type-check && pnpm test && pnpm check` green
* [ ] README + architecture doc updated
