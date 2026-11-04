# Agent Toolkit — State

The `ToolState` slices, their module accessors, the tagged geometries id, custom slices, dataset mode, and the state digest.
See [base reference](../agent-toolkit.md) for setup and `MapAgentOptions`.

---

## `ToolState` slices

Live state, shared by tools and your app via `agent.state`. Dataset slices keep an append-only history; each dataset owns
lazy SDK modules (all accessors are `async`).

| Slice | Holds | Module accessors |
|---|---|---|
| `places` | Place datasets, with attached geometries and connections | `getDatasetPlacesModule(id, markerType)`, `getDatasetGeometriesModule(id, fillStyle?)` |
| `routing` | Route datasets, planning waypoint slots, route `params` | `getDatasetRoutingModule(id)` |
| `ranges` | Reachable-range datasets — origins, budgets, polygons | `getDatasetRangesModule(id, fillStyle?)`, `getDatasetGeometriesModule(id, fillStyle?)`, `getDatasetPlacesModule(id)` |
| `customGeometries` | Polygons derived by `processData` (union, difference, h3 coverage, …) | `getDatasetGeometriesModule(id, fillStyle?)` |
| `byod` | Customer GeoJSON datasets with an inferred `BYODDataProfile` — [byod.md](./byod.md) | `getDatasetModule(id)` (`CustomGeoJSONModule`) |
| `trafficIncidents` | Fetched incident datasets, focused subsets, the live monitor | `getDatasetModule(id)` (`TrafficIncidentDetailsModule`) |
| `trafficAreaAnalytics` | Area-analytics datasets | `getDatasetModule(id)` (`TrafficAreaAnalyticsModule`) |
| `baseMap` | The `TomTomMap` (`ttMap`) and its MapLibre map (`mapLibreMap`) | `getBaseMapModule()`, `getStylingFoundationsModule()`, `getTerrainModule()` |
| `trafficTiles` | Traffic flow / incident tile overlays | `getTrafficFlowModule()`, `getTrafficIncidentsModule()` |
| `mapPOIs` | Base-map POI layer | `getPOIsModule()` |

Each dataset slice holds its modules' look as a `SliceKnobs` — `routing.knobs`, `places.knobs` / `places.geometriesKnobs`,
`ranges.knobs` / `ranges.geometriesKnobs` / `ranges.placesKnobs`, `customGeometries.knobs`, `trafficAreaAnalytics.knobs`,
`trafficIncidents.knobs`: `set(id, value)` / `reset(id)` / `resetAll()` / `values` by the module catalogue's ids, applied to
every module of that kind the slice holds and to each one it creates later (`setMapStyling` writes through them).
`trafficAreaAnalytics` shows a dataset's `activeMetric` only if the dataset fetched it, else its first metric.

Session-level fields: `analyses` (every `analyseData` result), `trackers`, `engine` (re-runs monitored analyses and
trackers when their source datasets change), `codeExecution` (the sandbox executor).

Common reads from app code:

```ts
agent.state.routing.currentRoutes;   // most recent Routes
agent.state.places.latestPlace;      // places of the most recent dataset
agent.state.places.datasets;          // full history
agent.state.places.shownDatasetIds;    // ids currently on the map
agent.state.byod.latestDataset;        // most recent BYOD dataset
agent.state.baseMap.mapLibreMap;     // raw maplibre-gl Map
```

Writers for custom tools: `state.places.addPlaceResult(place | places, label, explicitId?, connections?, geometries?)`,
`state.byod.addDataset(data, label, { layers?, source?, explicitId? })`.

---

## Tagged geometries id

`recallState({ kind: 'geometries' })` and the data-tool `geometriesDatasetIDs` input take tagged ids selecting polygons from
four sources:

```ts
type GeometriesIdKind = 'place' | 'places' | 'ranges' | 'customGeometries';

// { kind: 'place', id: '<placeId>' }            → one place's footprint
// { kind: 'places', id: '<placesDatasetId>' }     → every footprint in a places dataset
// { kind: 'ranges', id: '<rangesDatasetId>' }     → every polygon in a ranges dataset
// { kind: 'customGeometries', id: '<datasetId>' } → a processData-derived dataset
```

---

## Custom state slice

```ts
import type { StateSlice, ToolState } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

class FleetState implements StateSlice {
    vehicles = new Map<string, VehiclePosition>();
    reset() { this.vehicles.clear(); }
}

interface MyState extends ToolState {
    fleet: FleetState;
}

createMapAgent<MyState>(map, {
    model,
    state: { fleet: new FleetState() },
});
```

`destroy()` calls `reset()` on every slice that implements `StateSlice`, built-in and custom. The `resetState` tool calls it on every custom one too.
The model only knows what a tool returns this turn — give it a tool that reads the slice back.

---

## Dataset mode

`DatasetMode` is `'multiple'` (default — several datasets on the map) or `'single'` (only the latest stays; switching drops
the rest). Slices: `places`, `routing`, `ranges`, `customGeometries`, `byod`, `trafficAreaAnalytics`, `trafficIncidents`
— exported as `DATASET_MODE_SLICE_NAMES` / `DatasetModeSliceName` (slice keys, not `AnalysableDatasetKind`s):

```ts
import { DATASET_MODE_SLICE_NAMES } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

for (const slice of DATASET_MODE_SLICE_NAMES) {
    console.log(slice, agent.state[slice].datasetMode);
}
await agent.state.routing.setDatasetMode('single');
```

- Defaults per kind: `createMapAgent(map, { datasets: { routes: { datasetMode: 'single' } } })`.
- The model switches it with the `setDatasetMode` tool (*"only show one route at a time"*).

---

## State digest — tell the model what the user changed

When your UI changes the map between turns, diff two digests and prepend the summary to the next prompt:

```ts
import { formatStateDigestDiff, getStateDigest } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

let baseline = getStateDigest(agent.state);              // after each assistant turn
// … user clicks around …
const diff = formatStateDigestDiff(baseline, getStateDigest(agent.state)); // before the next prompt
const prompt = diff ? `${diff}\n${userText}` : userText;
```

`StateDigest` covers what is shown for places, routes, ranges, traffic, incidents, custom geometries and BYOD;
the diff is `null` when nothing changed.
