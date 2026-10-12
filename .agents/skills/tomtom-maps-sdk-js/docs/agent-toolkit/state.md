# Agent Toolkit — State

The `ToolState` slices, their module accessors, the tagged geometries id, custom slices, entry mode, and the state digest.
See [base reference](../agent-toolkit.md) for setup and `MapAgentOptions`.

---

## `ToolState` slices

Live state, shared by tools and your app via `agent.state`. Entry slices keep an append-only history; each entry owns
lazy SDK modules (all accessors are `async`).

| Slice | Holds | Module accessors |
|---|---|---|
| `places` | Place entries, with attached geometries and connections | `getEntryPlacesModule(id, markerType)`, `getEntryGeometriesModule(id, fillStyle?)` |
| `routing` | Route entries, planning waypoint slots, route `params` | `getEntryRoutingModule(id)` |
| `ranges` | Reachable-range entries — origins, budgets, polygons | `getEntryRangesModule(id, fillStyle?)`, `getEntryGeometriesModule(id, fillStyle?)`, `getEntryPlacesModule(id)` |
| `customGeometries` | Polygons derived by `processData` (union, difference, h3 coverage, …) | `getEntryGeometriesModule(id, fillStyle?)` |
| `byod` | Customer GeoJSON entries with an inferred `BYODDataProfile` — [byod.md](./byod.md) | `getEntryModule(id)` (`CustomGeoJSONModule`) |
| `trafficIncidents` | Fetched incident entries, focused subsets, the live monitor | `getEntryModule(id)` (`TrafficIncidentDetailsModule`) |
| `trafficAreaAnalytics` | Area-analytics entries | `getEntryModule(id)` (`TrafficAreaAnalyticsModule`) |
| `baseMap` | The `TomTomMap` (`ttMap`) and its MapLibre map (`mapLibreMap`) | `getBaseMapModule()`, `getStylingFoundationsModule()`, `getTerrainModule()` |
| `trafficTiles` | Traffic flow / incident tile overlays | `getTrafficFlowModule()`, `getTrafficIncidentsModule()` |
| `mapPOIs` | Base-map POI layer | `getPOIsModule()` |

Each entry slice holds its modules' look as a `SliceKnobs` — `routing.knobs`, `places.knobs` / `places.geometriesKnobs`,
`ranges.knobs` / `ranges.geometriesKnobs` / `ranges.placesKnobs`, `customGeometries.knobs`, `trafficAreaAnalytics.knobs`,
`trafficIncidents.knobs`: `set(id, value)` / `reset(id)` / `resetAll()` / `values` by the module catalogue's ids, applied to
every module of that kind the slice holds and to each one it creates later (`setMapStyling` writes through them).
`trafficAreaAnalytics` shows an entry's `activeMetric` only if the entry fetched it, else its first metric.

Session-level fields: `analyses` (every `analyseData` result), `trackers`, `engine` (re-runs monitored analyses and
trackers when their source entries change), `codeExecution` (the sandbox executor).

Common reads from app code:

```ts
agent.state.routing.currentRoutes;   // most recent Routes
agent.state.places.latestPlace;      // places of the most recent entry
agent.state.places.entries;          // full history
agent.state.places.shownEntryIds;    // ids currently on the map
agent.state.byod.latestEntry;        // most recent BYOD entry
agent.state.baseMap.mapLibreMap;     // raw maplibre-gl Map
```

Writers for custom tools: `state.places.addPlaceResult(place | places, label, explicitId?, connections?, geometries?)`,
`state.byod.addEntry(data, label, { layers?, source?, explicitId? })`.

---

## Tagged geometries id

`recallState({ kind: 'geometries' })` and the data-tool `geometriesEntryIDs` input take tagged ids selecting polygons from
four sources:

```ts
type GeometriesIdKind = 'place' | 'places' | 'ranges' | 'customGeometries';

// { kind: 'place', id: '<placeId>' }            → one place's footprint
// { kind: 'places', id: '<placesEntryId>' }     → every footprint in a places entry
// { kind: 'ranges', id: '<rangesEntryId>' }     → every polygon in a ranges entry
// { kind: 'customGeometries', id: '<entryId>' } → a processData-derived entry
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

`destroy()` calls `reset()` on every slice that implements `StateSlice`, built-in and custom.
The model only knows what a tool returns this turn — give it a tool that reads the slice back.

---

## Entry mode

`EntryMode` is `'multiple'` (default — several entries on the map) or `'single'` (only the latest stays; switching drops
the rest). Slices: `places`, `routing`, `ranges`, `customGeometries`, `byod`, `trafficAreaAnalytics`, `trafficIncidents`
— exported as `ENTRY_MODE_SLICE_NAMES` / `EntryModeSliceName` (slice keys, not `EntryDataKind`s):

```ts
import { ENTRY_MODE_SLICE_NAMES } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

for (const slice of ENTRY_MODE_SLICE_NAMES) {
    console.log(slice, agent.state[slice].entryMode);
}
await agent.state.routing.setEntryMode('single');
```

- Defaults per kind: `createMapAgent(map, { dataEntries: { routes: { entryMode: 'single' } } })`.
- The model switches it with the `setEntryMode` tool (*"only show one route at a time"*).

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
