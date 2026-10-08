# Coding Guidelines

Normative for every change in this repository. Each concern has one owner, and this file links to the others
rather than restating them:

| For | Read |
|---|---|
| The shared vocabulary — integrator, standard host, response detail, geometry, viz cache | [`CONTEXT.md`](./CONTEXT.md) |
| Why a design is the way it is | [`docs/adr/`](./docs/adr/README.md) |
| Adding a tool or a tool input, and the checks that enforce it | [`Adding_new_tools.md`](./Adding_new_tools.md) |
| Sign-off, formatting scope, the PR process | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| Verifying a finished change | the `tomtom-mcp-preflight` skill |
| Writing its pull request | the `tomtom-mcp-pr-description` skill |

The vendored `mcp-builder` skill is generic MCP guidance. Where it disagrees with this repository — snake_case
tool names, a `response_format` switch, `structuredContent` ([ADR 0007](./docs/adr/0007-geometry-key-in-text-json.md)) —
the documents above win.

`biome.json` decides what a linter can decide, and CI enforces `pnpm lint` plus `pnpm format:changed`. Nothing
below restates those. Everything here is a judgement Biome and `tsc` cannot make for you.

## 1. Reuse before adding

- **Search before writing.** `git grep` the concept first. The shared homes:

  | Concern | Lives in |
  |---|---|
  | API key and request session | `requireApiKey()`, `runWithSessionContext()` in `src/services/base/tomtomClient.ts` |
  | Narrowing a string input to the SDK's values | `src/services/shared/sdkInputs.ts` |
  | The `show_ui` and `response_detail` inputs | `src/schemas/shared/responseOptions.ts` |
  | The tool result: trim, viz cache, geometry, errors | `buildToolResponse()` / `buildErrorResponse()` in `src/handlers/shared/responseTrimmer.ts`; features in `geometryResponse.ts`, the vertex cap in `simplify.ts` |
  | Geometry math | `src/services/map/geometryUtils.ts` |
  | Registering a tool with its app | `registerTomTomAppTool()` in `src/tools/helpers/` |
  | HTTP outside the maps-sdk | `fetch` from `src/utils/http.ts` for TomTom's auth and account services; a user's `data_url` only through `dataVizHandler.ts`'s validated, pinned fetch |
  | Errors and logging | `src/types/types.ts`, `src/utils/apiErrorHandler.ts`, `src/utils/logger.ts` |
  | Stubbed requests and API responses in tests | `src/services/shared/recordFetch.ts`, `cannedApiResponses.ts` |
  | Code two MCP apps share | `src/apps/shared/` |

- **One concept, one definition.** A second type with the same shape, a second constant with the same value, a
  second helper with the same job — extend or parameterise the existing one instead.
- **Extend, don't fork.** A variant of existing behaviour is an argument or a narrowed type on the existing
  function, never a copy with two lines changed.
- **Data duplicates too** — enumerated values come from the SDK's runtime lists
  ([`Adding_new_tools.md`](./Adding_new_tools.md)), and a category table or unit factor has one home. Add a
  named entry to it rather than a second literal.
- **Delete what you replaced.** A superseded helper, type or constant leaves in the same change as its
  successor, including the import that reached it — `noUnusedImports` is only a warning here, so nothing
  fails when you forget. A retired tool takes its `src/apps/<category>/<app>/` directory with it: an orphaned
  app still builds, silently.

## 2. Types: make illegal states unrepresentable

- **Discriminated unions over co-optional properties** in internal types. Properties that cannot coexist, or
  that must appear together, belong in a union behind a literal discriminant — not in separate `?:` fields
  guarded at runtime.

  ```typescript
  // Nothing rejects `{ radiusMeters: 500, boundingBox }`
  type BadArea = { radiusMeters?: number; boundingBox?: BBox };

  type Area = { mode: "radius"; radiusMeters: number } | { mode: "boundingBox"; boundingBox: BBox };
  ```

  A tool's input schema is the exception: it stays flat, as the model sees it, and the service rejects the
  invalid combinations ([`Adding_new_tools.md`](./Adding_new_tools.md), step 3 of adding an input).
- **`?` means "absent is a valid state"** — not "required in some other mode". If a field is mandatory in one
  mode, model the modes.
- **Derive, never restate.** A handler's parameters are its schema's `z.input` type and a service's options a
  `Pick` of it; `Omit`, `Extract`, `keyof` and indexed access do the rest.
- **Literal unions over `string` and `number`** whenever the value set is known. Use an `as const` array or
  object plus `(typeof values)[number]` when the values are needed at runtime too.
- **No cast a narrow would do.** `as` discards the case the compiler found — add the type guard or fix the
  type. (`as const` is not a cast in this sense.)
- **Return precisely.** Return what the function produces, not a union covering every caller; split into
  overloads or add a type parameter instead.
- **Types shared across a domain** go in its `types.ts` (`src/services/<domain>/types.ts`); a type one file
  uses stays in that file.

## 3. Comments and docs: compact

- **Comment only what the code cannot state** — a unit, an invariant, an ordering constraint, a workaround and
  its cause.
- **Never narrate the next line.** A comment restating the statement below it doubles what a reader has to keep
  correct and says nothing the code did not.
- **Explain a concept once, where it belongs** — at the type, the module header, `CONTEXT.md` or the ADR that
  owns it, and point at that from everywhere else.
- **Document the end state, not the change.** No "was renamed", "no longer throws", "used to" in code comments
  and JSDoc — the diff, `CHANGELOG.md` and the ADRs carry history.
- **JSDoc on exports**: one-line summary, then `@param` / `@returns` only where the name does not already
  carry it. A tag that repeats the signature is noise.
- **Keep prose short**: at most three lines per paragraph and two paragraphs per block. Beyond that, switch to a
  bullet list or a table.
- **No filler** — "this is useful for…", "simply", "note that", "as you can see", emoji.
- **A tool's `description` and `.describe()` texts are product, not commentary** — they decide what the model
  calls and how. A coordinate states its order, a quantity its unit, and a sentence every tool shares comes
  from a helper such as `omittedUnlessGeometry()`; `src/tools/toolDescriptions.test.ts` pins the ones that
  must agree across tools.
- **A new source file starts with the Apache licence header its neighbours carry**: the full one in the server
  tree, `scripts/` and `e2e/`, the two-line one in `src/apps/`. Nothing adds it for you.

## 4. Structure and imports

- **Import from the file that defines a symbol.** The tool files take schemas through `src/schemas/index.ts`;
  add no other barrel, and no file forwards a symbol that originates elsewhere.
- **Export nothing that need not be public** — an export nobody imports is dead code that looks alive.
- **MCP apps are separate bundles.** `src/apps/**` is built by Vite into single-file HTML, so an app may import
  pure data and helpers from the server tree but never anything that reaches Node (`node:*`, the logger,
  `appConfig`).

## 5. Naming

- **Never abbreviate.** `response` not `res`, `request` not `req`, `error` not `err`, `index` not `idx`,
  `element` not `el`, `reference` not `ref`, `argument` not `arg`, `destination` not `dest`, `source` not
  `src`, `message` not `msg`, `previous` not `prev`, `current` not `curr`.
- **Three exceptions: loop counters, `config`, and `params`.** The SDK's types already carry the last two —
  `GeocodingParams`, `TomTomConfig` — so spelling them out in new code alone puts two words for one concept in
  the same file.
- **Use the terms of [`CONTEXT.md`](./CONTEXT.md)** in code, issues and reviews; a new concept gets its entry
  there.
- **Specific over generic** in an exported signature: `routeIndex`, `placeQuery` — not `index`, `query`.
- **A new tool input follows the naming of its tool's existing inputs**, casing included; `show_ui` and
  `response_detail` are snake_case everywhere. A new quantity names its unit: `radiusMeters`.
- **A new file follows its neighbours' casing.**
- **A tool name is `tomtom-` plus kebab-case**, like the existing ones. Renaming one breaks every client that
  calls it.

## 6. Syntax Biome leaves to you

- **Match the file.** `function` declarations are this codebase's norm, arrows its norm for callbacks and
  one-expression helpers. Don't convert code the change does not otherwise touch.

## 7. Domain rules

- **Coordinates are `[longitude, latitude]`** (GeoJSON order) in schemas and code. Where an API wants
  `"lat,lon"`, convert at the service boundary.
- **stdout belongs to JSON-RPC.** In stdio mode a stray write to stdout corrupts the protocol stream, so server
  code (`src/` outside `src/apps/`) never calls `console.*`; it logs through `logger` (`src/utils/logger.ts`),
  which writes to stderr.
- **Errors are `ErrorWithData` subclasses** from `src/types/types.ts`, picked by failure category
  (`IncorrectError`, `NotFoundError`, …); `handleApiError` maps upstream failures onto them, and a handler
  returns `buildErrorResponse()` rather than throwing.
  - Do not interpolate values into the `message`. Pass them in the `data` argument, and only those worth having
    when debugging.
  - The message may name the parameters, and names the next valid action: "Unknown POI categories. Use
    tomtom-poi-categories to find valid category codes." An `IncorrectError`'s `data` reaches the model as
    `details` (`toErrorPayload`), so the offending and valid values go there.
- **Geometry reaches the model only when asked for** ([ADR 0001](./docs/adr/0001-geometry-serves-integrators.md)):
  a tool with geometry offers `response_detail: "geometry"` and builds it through `geometryResponse.ts`.
- **Every tool input reaches the API request** ([ADR 0008](./docs/adr/0008-tool-inputs-reach-the-sdk.md)); the
  steps and checks are in [`Adding_new_tools.md`](./Adding_new_tools.md).
- **No service result carries the API key** — the maps-sdk copies request parameters into some results.
  `src/services/apiKeyLeak.test.ts` covers each service function; a new one gets a case there.

## 8. Tests

- **A sibling `<name>.test.ts` beside the source it covers** (`src/**/*.test.ts` is what `pnpm test` runs).
- **Live API calls stay in service tests and `*.integration.test.ts`** — they run under `pnpm test` and spend
  quota. Everywhere else, stub `fetch` with `recordFetch` or `cannedApiResponse`.
- **Assert, don't log.** A test whose body prints a response instead of expecting something is not a test.

## 9. Dependencies

- **Add with `pnpm add`, and commit the matching `pnpm-lock.yaml`** — CI's `--frozen-lockfile` fails before
  running any code without it. `ui/` is a workspace member on the same lockfile; a package both declare moves
  in both at once.
- **Transitive security pins** go in `overrides` in `pnpm-workspace.yaml`, with no other home.
- **Renaming or removing a tool, a tool input or an environment variable is a repo-wide change.** Start from
  `git grep -l '<oldName>'` — the preflight skill walks the surfaces that go stale without a compile error.
