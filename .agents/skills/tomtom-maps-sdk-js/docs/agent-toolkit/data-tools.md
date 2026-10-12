# Agent Toolkit — Scope-aware data tools

The unified `analyseData` / `processData` tools, the sandbox their generated code runs in (`createTracker` and
`clusterIncidents` code too), and per-turn scoping.
See [base reference](../agent-toolkit.md) for setup, [tools.md](./tools.md) for the registry.

---

## Inputs

Both tools take any combination of `placesEntryIDs` / `routesEntryIDs` / `incidentsEntryIDs` / `geometriesEntryIDs` /
`trafficAreaAnalyticsEntryIDs` / `byodEntryIDs` plus a `code` string (a JS function body). The sandbox receives one
per-entry record per kind — no merged collection:

| Kind (`EntryDataKind`) | Sandbox identifier | Value per entry |
|---|---|---|
| `places` | `placesByEntry` | `FeatureCollection` |
| `routes` | `routesByEntry` | `FeatureCollection` |
| `incidents` | `incidentsByEntry` | incident array |
| `customGeometries` | `geometriesByEntry` | polygon array, keyed by the tagged source `${kind}:${id}` (a place's, a range's or a custom geometry's polygons) |
| `trafficAreaAnalytics` | `trafficAreaAnalyticsByEntry` | `FeatureCollection` of tile / hex regions |
| `byod` | `byodByEntry` | `FeatureCollection` |

Span entries with `Object.values(...)` (`.flatMap((fc) => fc.features)` for collections, `.flat()` for arrays).

Libraries also injected: `turf`, `h3`, `routeUtils` (route slicing), `cluster(incidents, params?, previous?, now?)`
(DBSCAN, `{ eps?, minMembers?, maxClusters?, preFilter? }`). Standing runs (a monitored analysis, a monitor tick) add
`previous`, `now`, `log`.

## `analyseData`

- Extra inputs: `name`, `description?`, `outputFormat?` (`'json'` default, or `'chart'` for a Chart.js config —
  `bar` / `line` / `pie` / `doughnut` / `radar` / `polarArea` / `scatter` / `bubble`), `monitor?`.
- Returns an `analysisId`. `monitor: true` recomputes the analysis on every source change;
  `monitorAnalysis({ analysisId, enabled })` toggles it later.

## `processData`

- Extra inputs: `label?`, `entryId?` (overwrite), `operation?`, `show?`.
- `code` returns one of `{ places }` (optionally with attached `geometries` and `placeConnections`), `{ geometries }`
  (a new `customGeometries` entry) or `{ byod }`; `fitOnMap` composes with any of them.

## `clusterIncidents`

Groups incidents into hotspots; scopable too. Unscoped it covers incidents only; scoped, it also accepts the context kinds
(places, routes, …) the query filters against. Optional `code` filters or combines the inputs and returns `cluster(...)`,
in the sandbox; without it the default clustering runs.

---

## Sandbox

- **Browser:** `analyseData` / `processData` / `createTracker` / `clusterIncidents` code runs in a Web Worker inside a sandboxed opaque-origin iframe with CSP
  `default-src 'none'` — no DOM, network or storage. The worker is terminated on timeout (`codeExecution.timeoutMs`,
  default 10 s). Mandatory, no opt-out; the worker libraries load lazily.
  If the iframe cannot start, execution falls back to the main thread with a `console.warn`.
- **Node / SSR:** main thread, no isolation.
- **Everywhere:** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`,
  `document`, `window`, `globalThis`, `self`, `navigator`, `importScripts`, `process` are shadowed to `undefined` —
  a tripwire, not a boundary. Inputs are copied, so code can mutate them.
- **`executeMaplibreCode`** runs in the host page, unshadowed — remove it unless the deployment trusts the model.

```ts
createMapAgent(map, {
    model,
    codeExecution: {
        timeoutMs: 5_000,
        // Self-host the worker libraries; the source must define self.turf and self.h3
        // (plus self.routeUtils / self.cluster if generated code uses them).
        loadWorkerLibrarySource: async () => (await fetch('/sandbox-libs.js')).text(),
    },
});
```

Threat model: [code generation guide](https://docs.tomtom.com/maps-sdk-js/guides/plugins/agent-toolkit/code-generation.md).

---

## Per-turn scope

An unscoped data tool documents every enabled kind with its schema docs. To keep each request small, the classifier emits
`toolScopes[<name>] = { kinds: [...] }` for every scopable tool it picks (`analyseData`, `processData`, `clusterIncidents`;
`setMapStyling` scopes the same way by knob family, see [tools.md](./tools.md#notes-on-specific-tools)),
and `prepareStep` rebuilds that tool's `description` + `inputSchema` for the turn with only those kinds. Scoped or not, the
helper docs follow the active kinds: the cross-kind cheat-sheet when more than one is active, `routeUtils` with routes,
`cluster` with incidents.

- **Contract:** picking a scopable tool without a valid scope fails classifier validation. Two attempts; then the tool keeps
  its unscoped surface for the turn.
- **`classifier: false`:** scoping never engages.
- **`dataEntries[kind].enabled: false`:** the kind leaves both surfaces and the scope enum.
- **Observe:** `onClassify` receives `activeToolNames` and `toolScopes`:

```ts
onClassify: (result) => {
    console.log(result?.activeToolNames); // ['analyseData', 'recallState']
    console.log(result?.toolScopes);      // { analyseData: { kinds: ['places', 'routes'] } }
},
```

## Add a scopable custom tool

Declare `scopeSchema` + `scopePrompt` and build the entry from a `ToolEntryBuilder` that reads `options.scope`:

```ts
import { z } from 'zod';
import type { ToolEntryBuilder } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

type FleetScope = { kinds: ('vehicles' | 'jobs')[] };

const fleetScopeSchema = z.object({
    kinds: z.array(z.enum(['vehicles', 'jobs'])).min(1),
});

const fleetAnalyseBuilder: ToolEntryBuilder<MyState, FleetScope> = ({ scope }) => ({
    description: scope ? `Analyse ${scope.kinds.join(' + ')} entries via dynamic JS.` : 'Analyse fleet data.',
    inputSchema: buildFleetSchema(scope),
    execute: executeFleetAnalyse,
    scopeSchema: fleetScopeSchema,
    scopePrompt: 'Emit `{ kinds: ["vehicles" | "jobs"] }` listing only the kinds the user query touches.',
});

createMapAgent<MyState>(map, {
    model,
    state: { fleet: new FleetState() },
    tools: { fleetAnalyse: fleetAnalyseBuilder },
});
```

`scope` is `undefined` at creation and on turns without a scope — return a working unscoped entry then.
