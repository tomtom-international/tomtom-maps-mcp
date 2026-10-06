# 8. Every tool input reaches the API through the maps-sdk, checked at build and test time

- Status: accepted
- Date: 2026-10-05

## Context

A tool input passes three layers on its way to the TomTom API:

1. the **tool schema**, which the model sees in tools/list;
2. the **service options**, a `Pick` of the schema that the tool's service maps;
3. the **maps-sdk parameters**, which the SDK turns into the request.

#298 typed the third layer: the service request builders assign to the SDK's parameter types, so a misspelt or misplaced key fails `pnpm type-check`. Nothing checked that the other two layers stayed in step. Handlers pass the whole input object, so a schema key missing from the `Pick` still compiles, and the service drops it. The SDK did not catch it either:
- its own validation accepts unknown keys and ignores them;
- some parameters are typed but never sent by its request builders. In 0.51.5 these are reverse geocode `view` and `returnMatchType`, and `extendedRouteRepresentations`.

v1.6.11 advertised about 80 inputs that never reached the API. One was `tomtom-ev-search`'s `minPowerKW`, which filtered only the first page and so found no stations in city centres. Another was every vehicle input of `tomtom-routing`.

## Decision

A tool input exists only if it reaches the API request. If the SDK cannot send an input, the input is removed rather than kept as a no-op. Each layer has one check:

| Layer | Rule | Check |
| --- | --- | --- |
| Schema → options | Every schema key is in the service's options `Pick`, or the handler consumes it. `show_ui`, `response_detail` and the positional input (`query`, `position`, `locations`, `origin` or `bbox`) are handler inputs. `tomtom-dynamic-map`'s route plans are checked against the routing options the same way. | `src/tools/toolInputsMapped.test.ts`: `Unmapped<Schema, Options>` must be `never`, or `pnpm type-check` fails and names the key. |
| Options → SDK parameters | Builders assign to the SDK parameter types and never cast into them. | `pnpm type-check`. `src/services/sdkParamTyping.test.ts` pins known wrong keys, and rejects casts (`as …Params`, `as unknown as`, `as any`, `as never`, `<…Params>`) and `@ts-ignore` in the builders. |
| SDK parameters → request | Adding any one input changes the request the SDK sends. | `src/tools/toolInputsReachApi.test.ts` calls every API tool through the real server with `fetch` stubbed, once with a baseline and once with one input added or changed, and compares the URL, body and headers. It also fails on an input without a sample value, on a table entry for an input no tool has, and on an input listed as not sent that changes the request. |
| Values | Enumerated values come from the SDK's runtime lists: `z.enum(list)` for single values and arrays. Comma-separated strings are checked in `src/services/shared/sdkInputs.ts` against the SDK list. Where the SDK exports only a type, they are checked against a keyed `Record<SdkType, true>`. | When the SDK changes a list, the enums follow it, and a keyed record that drifts from its type fails `pnpm type-check`. Unknown values fail with the valid values listed. |

Rules that the SDK enforces by silently dropping input become errors. Examples: engine inputs without a matching `vehicleEngineType`, and half of the altitude consumption pair. These throw an `IncorrectError` that names the inputs.

The same holds one step further, at the API: an input the API receives but ignores is removed, or rejected in the combinations where the API ignores it. Each case was found by calling the live API with and without the input. Examples: `tomtom-routing`'s current fuel and charge (removed), engine and consumption inputs on a time or distance reachable range, a second reachable-range budget, unpaired efficiency inputs, and a nearby search without a POI filter (rejected). The service request tests pin these rejections. The runtime check cannot find new cases, because it stubs the API.

## Consequences

- **New schema keys:** an unmapped key fails type-check. A key that is mapped but never reaches the request fails `toolInputsReachApi.test.ts`.
- **SDK upgrades:** if an upgrade stops sending a parameter, the runtime check fails. If it renames a parameter or changes a value list, type-check fails.
- **Cost:** every new input needs a sample value in `toolInputsReachApi.test.ts`, plus a companion when it only works with other inputs. Every new API tool needs a baseline, and the check fails until it has one.
- **Limit:** the runtime check proves that the request changes, not which API parameter carries the value. The service request tests pin the parameter names where a mix-up is plausible: the power bounds, the vehicle, and the EV consumption.
- **Traffic:** `tomtom-traffic` calls `trafficIncidentDetails` like the other API tools. Its `fields` input was dropped: the SDK requests a fixed set of fields, the same as the tool's default, and the one field outside it (`aci`) is always null.
- **Out of scope:** tools that call no TomTom API: `tomtom-data-viz` and the app-internal tools. `tomtom-dynamic-map` calls the Routing API only for its `routePlans`, whose inputs are nested: type-check covers their keys, and `dynamicMapService.test.ts` checks that they reach `getRoute`.
