# Adding tools and tool inputs

Every tool that calls a TomTom API goes through the [maps-sdk](https://www.npmjs.com/package/@tomtom-org/maps-sdk), and every input a tool advertises must reach the API request. [ADR 0008](docs/adr/0008-tool-inputs-reach-the-sdk.md) records why. Type-check and the unit tests enforce it, so the steps below are also what CI checks.

An input flows through four files:

```
src/schemas/<area>/…Schema.ts      the tool schema the model sees
src/handlers/<area>Handler.ts      takes show_ui / response_detail, passes the rest on
src/services/<area>/…Service.ts    maps the options to the SDK's parameter type
@tomtom-org/maps-sdk               builds and sends the request
```

## Adding an input to an existing tool

1. **Schema.** Add the key to the tool's schema.
   - Take enumerated values from the SDK's runtime list, e.g. `z.enum(views)` or `z.array(z.enum(inputSectionTypes))`, so tools/list and validation follow SDK upgrades.
   - For a comma-separated string, build the description from the list, as `GEOGRAPHY_TYPES_HINT` does.
2. **Options.** Add the key to the service's options `Pick` (e.g. `GeocodeOptions` in `searchService.ts`). Until you do, `pnpm type-check` fails in `toolInputsMapped.test.ts` with `ExpectNever<"yourKey">`.
3. **Builder.** Set the SDK parameter in the service's request builder. The builder variable has the SDK's type (`const params: GeocodingParams = …`), so a wrong key or value type fails type-check.
   - Never cast into an SDK type: `sdkParamTyping.test.ts` rejects casts and `@ts-ignore` in the builders.
   - Narrow strings with a converter from `src/services/shared/sdkInputs.ts` (`toGeographyTypes`, `toFuelTypes`, …). Converters check values against the SDK's lists and throw an `IncorrectError` listing the valid values.
   - If the input only works with other inputs, reject the bad combinations with an `IncorrectError` that names them, instead of letting the SDK drop the input. `toSearchArea` in `searchService.ts` is an example.
   - Call the live API with and without the input, in the combinations the tool allows. If the API returns the same response, the API ignores the input there: remove it, or reject that combination. The runtime check below stubs the API, so it cannot see this.
4. **Runtime check.** Add a sample value to `SAMPLES` in `src/tools/toolInputsReachApi.test.ts`, or a `COMPANIONS` entry if the input needs other inputs or a different value. The test fails if the input has no sample, or if adding it leaves the request unchanged. An input that only works with a partner goes in `with` together with the partner, so the check changes only the input itself.
5. **Name check, where a mix-up is plausible.** In the service's request test, assert the exact API parameter, using `recordFetch` from `src/services/shared/recordFetch.ts`. Examples are min and max bounds, or two inputs of the same type.

If the SDK cannot send the input, do not add it. If you find an advertised input that the SDK cannot send, remove it from the schema and record it under **BREAKING** in the CHANGELOG.

## Adding a tool

1. **Schema:** add `src/schemas/<area>/…Schema.ts`, with an exported `z.input` type for the handler.
2. **Service:** add a function that takes `(positional input, options: Pick<Schema, …>)` and builds the SDK parameters as above.
3. **Handler:** add `createXHandler()` in `src/handlers/<area>Handler.ts`:

   ```ts
   const { query, show_ui = true, response_detail = "compact", ...options } = params;
   const result = await geocodeAddress(query, options);
   return buildToolResponse(result, trimForCompact, { showUI: show_ui, responseDetail: response_detail });
   ```

   On failure, return `buildErrorResponse(error, "…")`.
4. **Registration:** in `src/tools/<area>Tools.ts`, call
   `registerTomTomAppTool(server, { name, title, description, inputSchema, app: "<category>/<app>" }, createXHandler())`.
   It registers the MCP app under `src/apps/<category>/<app>/` and the read-only annotations.
   A tool whose result is places, routes or a search area uses `PLACES_AND_ROUTES_APP`
   rather than an app of its own: a host reads every app's HTML while connecting, one after
   another, so each extra app adds a read. That app tells results apart by their shape
   (`src/apps/map/places-and-routes/mapContent.ts`).
5. **Checks:**
   - In `toolInputsMapped.test.ts`, assert `Unmapped<Schema, Options, "<positional input>">` is `never`.
   - In `src/tools/toolBaselines.ts`, add an `API_TOOLS` entry; `toolInputsReachApi.test.ts` fails until every API tool has one, and the client tests call the tool with it. Then add samples for any new inputs in `toolInputsReachApi.test.ts`.
   - In `src/appListings.ts`, give the tool its row in `TOOLS_LIST`: its app URI and whether it takes `show_ui`, or `"app-only"`. The listing tests and the protocol probe fail until it has one. A new app also needs its file in `APP_FILES` (`src/createServer.clients.test.ts`) and a budget in `src/payloadBudgets.test.ts`.
   - Add the tool's scenarios to `tests/test-stdio-tools.js` and `tests/test-http-tools.js`.
6. **Name:** add the tool's name to `src/tools/toolNames.json`, in order. `retiredTools.test.ts` fails until you do.
7. **Docs:** add the tool to the README's tool list, the `tools` list in `manifest-binary.json` and the CHANGELOG, and open the docs portal's sibling PR ([CODING_GUIDELINES.md](CODING_GUIDELINES.md) § 10; the `tomtom-mcp-docs-update-pr` skill does it).

A tool that calls no TomTom API, such as `tomtom-data-viz`, goes in `NOT_API_TOOLS` in `src/tools/toolBaselines.ts`. So does `tomtom-dynamic-map`, whose route plans are nested inputs: type-check covers their keys, and `dynamicMapService.test.ts` checks that they reach `getRoute`.

## Renaming or removing a tool

A tool's name stays answered after the tool is gone ([ADR 0010](docs/adr/0010-retired-tool-names-answer.md)):

1. **Retire the name.** Add an entry to `RETIRED_TOOLS` in `src/tools/retiredTools.ts` with `lastRelease`, `replacedBy` and the `message` the caller reads ([CODING_GUIDELINES.md](CODING_GUIDELINES.md) § 7). A rename gets an entry for the old name.
2. **Keep the ledger.** Leave the name in `src/tools/toolNames.json`; add the new name for a rename.
3. **Follow replacements.** Any entry whose `replacedBy` names the tool you remove moves on to its replacement, with its `message` rewritten to match.
4. **Remove the rest:** the tool's tests, its scenarios in `tests/`, its MCP app if no tool uses it, and its entries in the README and `manifest-binary.json`.
5. **Changelog:** a **BREAKING** entry naming the tools to use instead.

## Before opening a PR

```
pnpm type-check && pnpm lint && pnpm format:changed && pnpm test
pnpm build && pnpm test:tools:stdio && pnpm test:tools:http
pnpm test:soak && pnpm test:e2e:protocol
pnpm ui:build && pnpm exec playwright test e2e/tools.spec.ts e2e/hostProfiles.spec.ts
```

The unit, tool and spec host tests need `TOMTOM_API_KEY` in `.env`; the soak and the protocol probe need none. CI runs all of them. The `Agent review` check fails the PR
until the `tomtom-mcp-review` skill has posted a review.
