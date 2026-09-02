# Adding new tools to TomTom Maps MCP

How to add a **tool** (an API integration the model can call) and, optionally, the
**MCP app** that visualises its result.

Read [`docs/tools-architecture.md`](./docs/tools-architecture.md) first if you
haven't — especially *"Two audiences, one tool"*. Most of the steps below only make
sense once you know that a tool serves the model and the app differently.

The short version: **a tool is a row in `src/tools/tool-registry.ts`.** Everything
else exists to fill that row in.

Every tool that calls a TomTom API goes through the
[maps-sdk](https://www.npmjs.com/package/@tomtom-org/maps-sdk), and every input a
tool advertises must reach the API request.
[ADR 0008](docs/adr/0008-tool-inputs-reach-the-sdk.md) records why. Type-check and
the unit tests enforce it, so the steps below are also what CI checks.

---

## 1. Gather the API details

* Check that `@tomtom-org/maps-sdk` covers the endpoint. If the SDK cannot send a
  request or an input, the tool cannot offer it.
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
* Take `(positional input, options: Pick<Schema, …>)`, and list in the options
  `Pick` every tool input the service maps.
* Build the SDK parameters in a variable of the SDK's type
  (`const params: GeocodingParams = …`), so a wrong key or value type fails
  type-check. Never cast into an SDK type: `sdkParamTyping.test.ts` rejects casts
  and `@ts-ignore` in the builders.
* Narrow strings with a converter from `services/shared/sdkInputs.ts` (`toBBox`,
  `toLanguage`, `toGeographyTypes`, …). Converters check values against the SDK's
  lists and throw an `IncorrectError` listing the valid values.
* If an input only works with other inputs, reject the bad combinations with an
  `IncorrectError` that names them, instead of letting the SDK drop the input.
* Call the live API with and without each input, in the combinations the tool
  allows. If the response is the same, the API ignores the input there: remove it,
  or reject that combination. The runtime check in step 7 stubs the API, so it
  cannot see this.
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

Take enumerated values from the SDK's runtime list, e.g. `z.enum(routeTypes)`, so
tools/list and validation follow SDK upgrades.

---

## 4. Handler — `src/tools/services/<domain>.ts`

Call the service, then hand the result to `buildToolResponse`; failures go to
`buildErrorResponse`:

```ts
export async function elevationHandler(params: ElevationParams): Promise<ToolResponse> {
  const { positions, show_ui = false, response_detail = "compact", ...options } = params;
  try {
    const result = await getElevation(positions, options);
    return await buildToolResponse(result, trimElevationResponse, {
      showUI: show_ui,
      responseDetail: response_detail,
      dataset: { kind: "places", provenance: { tool: "tomtom-elevation", params } },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error, "Elevation lookup");
  }
}
```

`buildToolResponse` handles the `full` escape hatch, `geometry` (pass a
`geometry` builder from `geometry-response.ts`), storing the full payload for
the app, and minified JSON. `context` carries fields the tool adds about how it
got the result (where inputs resolved, what was searched), kept at every detail
level. Reject bad input by throwing `IncorrectError` inside the `try`, with the
values in its `data` rather than its message.

Put the trim in `src/tools/shared/response-trimmer.ts` with the other
projections — that module is deleted wholesale in phase 2, and scattering trims
across handlers is what phase 0 undid.

---

## 5. Register it — one row in `src/tools/tool-registry.ts`

```ts
{
  name: "tomtom-elevation",
  title: "TomTom Elevation",
  description:
    "Look up ground elevation in metres for one or more coordinates. " +
    "Use when the user asks about height, altitude, or terrain at a point. " +
    "Do NOT use for route gradients — use tomtom-plan-route.",
  inputSchema: tomtomElevationSchema,
  handler: elevationHandler,
  kind: "places",
  app: app("elevation/elevation-profile"),  // omit if no app
  tags: ["location"],
  examplePrompts: [
    "How high above sea level is Mont Blanc?",
    "What's the elevation at 52.379, 4.899?",
  ],
  relatedTools: ["tomtom-plan-route"],
}
```

Nothing else to touch. `register.ts` picks the row up, applies
`READ_ONLY_ANNOTATIONS`, and registers the app resource if `app` is set. Do **not**
add a `registerAppTool` call — there is exactly one in the codebase. Set
`openWorldHint: false` for a tool that answers from a fixed list or draws without
calling out, and `uiOnly: true` for a tool that only exists to draw, so clients
that render no MCP apps do not get it.

A tool whose result is places, routes or a search area uses `PLACES_AND_ROUTES_APP`
rather than an app of its own: a host reads every app's HTML while connecting, one
after another, so each extra app adds a read. That app tells results apart by their
shape (`src/apps/map/places-and-routes/mapContent.ts`).

### The description is the feature

Tool selection is decided almost entirely here. What works:

* Lead with what it does, in the user's words.
* Name the tools it is confusable with, and say when to use them instead — every
  existing near-miss pair does this (`discover-places` vs `locate-place`,
  `plan-route` vs `get-traffic`, `dynamic-map` vs `data-viz`).
* Encode ordering constraints explicitly, and mirror them in `dependsOn`.

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

Only if the result is worth *drawing*, and only if `PLACES_AND_ROUTES_APP` cannot
draw it. See the sequence diagram in
[`docs/tools-architecture.md`](./docs/tools-architecture.md#the-full-round-trip)
for the data flow.

1. Create `src/apps/<category>/<appName>/` with `app.ts` + `index.html`. Copy the
   closest sibling; `src/apps/shared/` has the API key, map controls, POI popups.
2. Get the full data with `extractFullData(app, agentResponse)` from
   `apps/shared/decompress.ts` — it redeems `_meta.dataset_id` via the app-only
   `tomtom-get-dataset`, with a `localStorage` fallback for when the 30-minute
   server-side dataset has expired.
3. Point the registry row's `app` at it with `app("<category>/<appName>")`. The
   path must match the directory — it locates the built HTML, and a mismatch
   renders an "App not found" placeholder instead of failing loudly.
4. `pnpm build:apps` (or `pnpm build:apps:<category>`).

Include `...uiVisibilityParam` in the schema so the model can pass `show_ui`.
Without an app, skip `app` **and** `show_ui` — `tomtom-poi-categories` has an app
but no `show_ui`, because its result is a lookup table.

> An app directory that no registry row references still gets built, silently, on
> every build — nothing warns you. If you retire a tool, delete its app directory
> in the same commit.

---

## 7. Tests

| Test | Where |
| --- | --- |
| Service against the real API | `src/services/<domain>/*.test.ts` |
| The exact API parameter, where a mix-up is plausible (min/max bounds, two inputs of one type) | the service's request test, with `recordFetch` from `services/shared/recordFetch.ts` |
| Handler with the service mocked | `src/tools/services/<domain>.test.ts` |
| Every input is in the service options or the handler's own list | `src/tools/toolInputsMapped.test.ts`: assert `Unmapped<Schema, Options, "<positional input>">` is `never` |
| Every input changes the API request | `src/tools/toolInputsReachApi.test.ts`: add a `BASELINES` entry, then a `SAMPLES` value per new input |
| Registry invariants, registration, boot | already generic — your row is covered automatically |
| Tool selection | add `examplePrompts` (step 5); no test file needed |
| Tool scenarios over stdio and HTTP | `tests/test-stdio-tools.js`, `tests/test-http-tools.js` |

In `toolInputsReachApi.test.ts`, an input that needs other inputs or a different
value gets a `COMPANIONS` entry. An input that only works with a partner goes in
`with` together with the partner, so the check changes only the input itself. An
input that by design changes no request goes in `NOT_SENT` with the reason; keep
that list short. A tool that calls no TomTom API, such as `tomtom-data-viz`, goes
in `NOT_API_TOOLS`.

If the tool unlocks a question that was previously unanswerable, add a task to
`evals/capability/tasks.ts` — `expected: "pass"` if it works now, `expected:
"blocked"` with a `blockedBy` reason if the data is still being trimmed away.

---

## 8. Document it

* Add a row to **Available Tools** in [`README.md`](./README.md), with a docs link.
* Add it to the tool-surface table in
  [`docs/tools-architecture.md`](./docs/tools-architecture.md#the-tool-surface).
* Add it to the CHANGELOG.
* A `docs/<tool>.md` page only if it has real setup or quirks.

---

## Before opening a PR

```
pnpm type-check && pnpm lint && pnpm format:changed && pnpm test
pnpm build && pnpm test:tools:stdio && pnpm test:tools:http
```

The unit and tool tests need `TOMTOM_API_KEY` in `.env`.

## Checklist

* [ ] The SDK sends every input the tool advertises
* [ ] Service returns the **untrimmed** response; uses `requireApiKey()`, an options `Pick`, an SDK-typed builder and the `sdkInputs` converters
* [ ] Schema is a Zod raw shape; every `.describe()` states units and coordinate order
* [ ] Handler via `buildToolResponse` / `buildErrorResponse`; projection lives in `response-trimmer.ts`
* [ ] One registry row — no new `registerAppTool` call
* [ ] Description names the tools it is confusable with
* [ ] `examplePrompts` present; `tags` from `tool-tags.ts`; `relatedTools` / `dependsOn` resolve
* [ ] `PLACES_AND_ROUTES_APP` reused where it can draw the result; a new app wired via `app` **and** built, or omitted entirely (no orphan directory)
* [ ] `toolInputsMapped.test.ts` and `toolInputsReachApi.test.ts` cover the new inputs
* [ ] README, architecture doc and CHANGELOG updated
