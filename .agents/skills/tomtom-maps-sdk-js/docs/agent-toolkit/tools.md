# Agent Toolkit — Tools

The tool registry, the `ToolEntry` shape, and how to add / replace / remove tools.
See [base reference](../agent-toolkit.md) for setup and `MapAgentOptions`.

---

## `DEFAULT_TOOLS` registry

Flat record of the 51 default tools; `TOOL_NAMES` lists their names and `ToolName` is the union type.

- **Location**: `locatePlace`, `reverseGeocode`, `getCurrentLocation`, `getViewport`, `calculateBBox`
- **Places & search**: `discoverPlaces`, `getPOICategoryCodes`
- **Routing**: `setRoute`, `addWaypointsToRoute`, `removeWaypointsFromRoute`, `replaceWaypointInRoute`, `getCurrentWaypoints`, `startRouteMonitor`, `stopRouteMonitor`
- **Reachable areas**: `findReachableAreas` — calls `calculateReachableRanges`, in private preview: the API key needs Calculate Reachable Range access ([routing.md](../routing.md#reachable-ranges-isochrones))
- **BYOD**: `addByodSource`, `setByodLayers`, `updateByodDisplay` — [byod.md](./byod.md)
- **Traffic incidents**: `getTrafficIncidents`, `setTrafficIncidentsMonitor`, `clusterIncidents`, `focusIncidents`
- **Traffic area analytics**: `getTrafficAreaAnalytics`, `updateTrafficAreaAnalyticsDisplay` (show / hide only; the look is `setMapStyling`'s)
- **Trackers (geofence / proximity alerts)**: `createTracker`, `getTrackers`, `getTrackerHistory`, `clearTracker`
- **Data tools (scopable)**: `analyseData`, `processData`, `monitorAnalysis` — [data-tools.md](./data-tools.md)
- **Map display**: `updatePlacesDisplay`, `updateRoutesDisplay`, `updateWaypointsDisplay`, `clearMap` — which entries show, not how they look
- **Map control**: `flyTo`, `zoomInOrOut`, `setPitchBearing`, `setMapStandardStyle`, `getStandardMapStyles`, `setLanguage`, `setGeopoliticalView`
- **Map styling**: `setMapStyling` — what the base map shows (layer groups, POI icons, the live traffic overlays) and how it looks, and the look of every layer the agent drew
- **MapLibre direct**: `executeMaplibreCode`, `getMapStyleLayers`, `setLayerProperties` (`changes: [{ layerId, paint?, layout? }]`)
- **State**: `recallState`, `setEntryMode`, `resetState`
- **Utilities**: `clarifyIntent`, `help`

Names are stable; reference entries as `DEFAULT_TOOLS.locatePlace`. Six entries are builders (`ToolEntryBuilder`):
`discoverPlaces`, `analyseData`, `processData`, `clusterIncidents`, `recallState`, `setMapStyling`.

`TOOLS_BY_DATA_ENTRY_KIND` maps each `DataEntryKind` to the tools dropped when `dataEntries[kind].enabled` is `false`.
`getDefaultToolPrompts()` returns `Record<ToolName, readonly string[]>` of every tool's `examplePrompts` — chat-UI starter
suggestions from the same source as the `help` tool.

### Notes on specific tools

- **`setMapStyling`** — `{ set?, reset?, preset?, theme? }`, applied in the order reset → preset → theme → set.
  `set` takes every knob id of the `StylingFoundationsModule`, `BaseMapModule`, `POIsModule`, `TrafficFlowModule`,
  `TrafficIncidentsModule` and `TerrainModule` catalogues, under the map-wide prefixes `''`, `pois.`, `traffic.flow.`,
  `traffic.incidents.` and `terrain.`: `labels.sizeFactor`, `groups.buildings3D.visible`, `pois.visible`,
  `pois.filters.categories.values`, `traffic.flow.visible`, `traffic.incidents.filters.magnitudes.values`,
  `terrain.elevation.visible`, …; `reset: true` resets every knob, visibility included, or pass ids; `preset` calls `applyMapPreset`;
  scopable: the classifier emits `{ kinds }` from `look`, `baseMap`, `pois`, `trafficFlow`, `trafficIncidents`, `terrain`
  and the `set` description lists only those families' ids, while any id stays settable; an unknown id is refused with
  the closest ones (`did you mean pois.label.color?`);
  the layers the agent drew take their module catalogues under `places.` (`PlacesModule`, the ranges' origin pins too),
  `routes.` (`RoutingModule`), `geometries.` (custom geometries, place boundaries, ranges drawn as geometries),
  `ranges.` (`ReachableRangesModule`), `traffic.areaAnalytics.` and `traffic.incidentDetails.`, minus `visible`,
  `markerType` and `fill.style`, which the display tools set per entry; families `places`, `routes`, `geometries`,
  `ranges`, `trafficAreaAnalytics`, `trafficIncidentDetails`; each slice's `SliceKnobs` (`state.routing.knobs`,
  `state.places.geometriesKnobs`, …) sets the knob on every module of that kind and on each one created later;
  `theme: { colors | imageUrl, mode }` themes the map and returns `switchedStyle` when it had to switch the standard style.
  See [map-styling.md](../map-styling.md), [map-theming.md](../map-theming.md).
- **`setGeopoliticalView`** — `{ geopoliticalView? }` from `geopoliticalViews`; sets it on the map
  (`setGeopoliticalView`) and in `TomTomConfig`, so later searches follow; omitted resets to the default view.
- **`setRoute`** — requests every travel time (`computeTravelTimeFor: 'all'`); each route summary also carries
  `sectionCounts` (`tollRoad`, `ferry`, `traffic`, … above zero) and the `countries` crossed (ISO3).
- **Errors** — a failed TomTom service or map call returns `{ error, code }`, `code` being the `SDKErrorCode`, the
  error text ending with whether retrying helps.
- **`recallState`** — reads state, never fetches. No args: session snapshot (places / routes / ranges index, entry modes,
  map style, POIs, traffic). `{ kind }`: that kind's index. `{ kind, id }`: one entry's summarised detail.
  Kinds: `places`, `routes`, `ranges`, `geometries`, `byod`, `incidents`, `trafficAreaAnalytics`.
- **`help`** — `{ mode: 'summary' | 'detail', query?, tag? }`, surfacing each tool's `description`, `examplePrompts` and `relatedTools`.
- **`setEntryMode`** — `{ slice, mode }`; see [state.md](./state.md).

---

## `ToolEntry` shape

```ts
type ToolEntry<S extends ToolState = ToolState, Scope = unknown> = {
    description: string;            // sent to the model
    inputSchema: z.ZodType;         // Zod-validated input
    outputSchema?: z.ZodType;       // structured output (dropped when outputSchemas: false)
    execute: (input: any, state: S, options?: ToolExecuteOptions) => Promise<any>; // never throw — return { error }

    // classifier and help metadata
    classificationPrompt?: string;  // one-liner the classifier reads (never the description)
    tags?: string[];                // category labels, filterable in help
    examples?: string[];            // in the ToolMetadata a custom classifier receives
    examplePrompts?: string[];      // shown by help
    relatedTools?: string[];        // listed by help
    dependsOn?: string[];           // tools that must run first; shown to the classifier

    // loop control
    alwaysActive?: boolean;         // active every step regardless of the classifier
    endsTurnOnCall?: boolean;       // calling it stops the loop (e.g. a tool whose UI collects the answer)

    // per-turn scope — data-tools.md
    scopeSchema?: z.ZodType<Scope>; // shape of `toolScopes[name]` the classifier emits
    scopePrompt?: string;           // explains the scope shape to the classifier
};
```

### Cancellation — `options.signal`

`execute`'s third argument carries the AI SDK's `abortSignal` for the call, which fires when the turn is cancelled:

```ts
type ToolExecuteOptions = { signal?: AbortSignal };
```

Forward it to every `@tomtom-org/maps-sdk/services` call; an aborted call rejects with `SDKAbortError`:

```ts
import { geocode, SDKAbortError } from '@tomtom-org/maps-sdk/services';

execute: async ({ query }, state, options) => {
    try {
        const results = await geocode({ query, signal: options?.signal });
        // ...
    } catch (error) {
        if (error instanceof SDKAbortError) return { error: 'Cancelled.' };
        return { error: `Search failed: ${error instanceof Error ? error.message : String(error)}` };
    }
},
```

**Never forward it into work that outlives the turn** (a monitor tick, a deferred job): it has already aborted by then,
and a monitor treats a rejected tick as fatal and clears its interval.

### Builders — `ToolEntryBuilder`

```ts
type ToolEntryBuilder<S, Scope = unknown> = (options: ToolBuildOptions<Scope>) => ToolEntry<S, Scope>;

type ToolBuildOptions<Scope = unknown> = {
    featureFlags?: FeatureFlags;
    scope?: Scope;                            // undefined at creation and when the turn emitted no scope
    enabledDataKinds?: readonly EntryDataKind[]; // kinds left enabled by dataEntries
};
```

Builders are called once at creation and again per turn when scoped — [data-tools.md](./data-tools.md).

---

## Add a custom tool

```ts
import { z } from 'zod';
import type { Place } from '@tomtom-org/maps-sdk/core';
import type { ToolEntry } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

const getFleetVehicle: ToolEntry = {
    description: 'Get the current map position of a fleet vehicle by ID and add it to the places history.',
    classificationPrompt: 'Locate or display a fleet vehicle on the map by its ID.',
    inputSchema: z.object({ vehicleId: z.string() }),
    execute: async ({ vehicleId }, state) => {
        const position = await fleetApi.getPosition(vehicleId);
        const place: Place = {
            type: 'Feature',
            id: `vehicle-${vehicleId}`,
            geometry: { type: 'Point', coordinates: position },
            properties: {
                type: 'POI',
                address: { freeformAddress: '' },
                poi: { name: `Vehicle ${vehicleId}`, categories: [], localizedCategories: [] },
            },
        };
        // Appends a places entry; the model shows it with updatePlacesDisplay.
        const entryId = await state.places.addPlaceResult(place, `Vehicle ${vehicleId}`);
        return { vehicleId, entryId, position };
    },
    tags: ['location'],
    examplePrompts: ['Where is vehicle TT-001?', 'Show fleet vehicle on the map'],
};

createMapAgent(map, { model, tools: { getFleetVehicle } });
```

### Resolve a place in a custom tool

`locatePlace(query, queryAs, bias?, execOptions?)` runs the `locatePlace` tool's lookup and returns the best `Place` or `null`
(`queryAs`: `'poi'` searches points of interest, `'place'` geocodes). `getViewportBias(state.baseMap)` returns the map centre as
`[lng, lat]`, or `undefined` below zoom `MIN_VIEWPORT_BIAS_ZOOM` (6). A failed or cancelled lookup rejects:

```ts
import { getViewportBias, locatePlace } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

execute: async ({ name }, state, options) => {
    try {
        const position = getViewportBias(state.baseMap);
        const place = await locatePlace(name, 'poi', position && { position }, options);
        if (!place) return { status: 'not_found' };
        return { entryId: await state.places.addPlaceResult(place, name) };
    } catch (error) {
        return { error: `Lookup failed: ${error instanceof Error ? error.message : String(error)}` };
    }
},
```

## Replace / remove default tools

```ts
createMapAgent(map, {
    model,
    tools: {
        setLanguage: false,                    // remove
        getCurrentLocation: myCustomGetLoc,    // replace (full ToolEntry)
    },
});
```

A tool you add or replace overrides `dataEntries[kind].enabled: false`.

## `getCurrentLocation` precision

Default: position rounded to 3 decimals (~100 m), `accuracy` of 111 m (or the device's, if coarser), no `timestamp`,
from a non-high-accuracy fix up to 60 s old. `createGetCurrentLocationTool({ fullPrecision: true })` sends the exact fix,
device accuracy and timestamp from a fresh high-accuracy fix. `getCurrentLocation: false` removes the tool, so "near me"
falls back to the viewport.

```ts
import { createGetCurrentLocationTool } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

createMapAgent(map, {
    model,
    tools: { getCurrentLocation: createGetCurrentLocationTool({ fullPrecision: true }) },
});
```

## `clarifyIntent` — prose or form

Default `clarifyIntent` is `alwaysActive` and asks the user in prose. For a UI that renders the questions as a form:

```ts
import { createClarifyIntentTool } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

createMapAgent(map, {
    model,
    tools: { clarifyIntent: createClarifyIntentTool({ rendersForm: true }) },
});
```

- `rendersForm: true` sets `endsTurnOnCall`: the turn ends on the call with no prose; render the call's
  `{ intro?, questions }` (`clarifyIntentSchema`, each question per `questionSchema`: `id`, `question`, `options`, `multiSelect`)
  and send the user's choices back as the next message.
- Default (`rendersForm: false`): the model narrates the questions as prose for form-less UIs.
- Other options: `description`, `classificationPrompt`, `examples`, `examplePrompts`, `alwaysActive` (default `true`).
- Prompts: `CLARIFY_PROSE_PROMPT`, `CLARIFY_FORM_PROMPT`.

## `getTrafficIncidents` `where`

`where: { mode: 'within', … }` takes the same multi-region fields as `discoverPlaces` (`viewport`, `boundingBox`, `queries`,
`placeIds`, `geometries`, `range`, `route`); they resolve to bboxes and are unioned (≤ 10,000 km²).
Omitted `where` means the viewport. A named area beats `viewport: true` when the model sends both.

```ts
getTrafficIncidents({});                                                                       // viewport
getTrafficIncidents({ where: { mode: 'within', queries: [{ query: 'Paris', queryAs: 'place' }] } });
getTrafficIncidents({ where: { mode: 'within', route: { widthMeters: 1000 } } });              // corridor around the latest route
getTrafficIncidents({ where: { mode: 'within', queries: [{ query: 'Amsterdam' }], placeIds: ['G55fc4abe-...'] } });
```

Other inputs: `categoryFilter`, `timeValidityFilter` (default `['present']`), `label`, `show` (default `true`), `fitBounds`,
`monitor` (default `true` when shown), `monitorIntervalMs` (default 60 s).

## Start blank, hand-pick built-ins

`tools` takes `ToolDefinition | false` — an entry, a builder or a `DEFAULT_TOOLS` value, no cast:

```ts
import { createMapAgent, DEFAULT_TOOLS } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';

createMapAgent(map, {
    model,
    includeDefaultTools: false,
    tools: {
        getFleetVehicle,
        locatePlace: DEFAULT_TOOLS.locatePlace,
        flyTo: DEFAULT_TOOLS.flyTo,
        analyseData: DEFAULT_TOOLS.analyseData,
    },
});
```

For a **scopable** custom tool (`scopeSchema` + `scopePrompt` + `ToolEntryBuilder`), see [data-tools.md](./data-tools.md).
