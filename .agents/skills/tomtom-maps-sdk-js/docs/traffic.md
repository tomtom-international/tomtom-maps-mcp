# Traffic Reference

## Imports

```ts
import {
    setKnob,
    TrafficFlowModule,
    TrafficIncidentsModule,
    TrafficIncidentDetailsModule,
    TrafficAreaAnalyticsModule,
    trafficFlowKnobCatalogue,
    trafficIncidentsKnobCatalogue,
} from '@tomtom-org/maps-sdk/map';
import { trafficIncidentDetails, trafficAreaAnalytics, geocodeOne, geometryData } from '@tomtom-org/maps-sdk/services';
```

> **Two incident modules, two different jobs.** `TrafficIncidentsModule` is the **vector-tile overlay** — live data baked into the map style, no fetch needed; you toggle visibility and filter. `TrafficIncidentDetailsModule` is the **GeoJSON renderer for the `trafficIncidentDetails()` service** — *you* fetch a snapshot, *you* hand it to `show()`, and you can highlight a subset via `setFocus()`. Use the tile module for "show me live traffic"; the details module when the app needs the structured data (ids, delays, geometry) *and* renders exactly what it fetched.

> **Hidden until you show them.** The style parts the SDK adds — traffic flow, traffic incidents and the hillshade — are hidden until shown: pass `{ visible: true }` to `get()` or call `setVisible(true)` — for `TerrainModule`, `{ hillshade: true }` or `setHillshadeVisible(true)`.

> **Flow and incidents are style-owned.** `get()` returns the one instance per map, and reloads the style with the `trafficFlow` / `trafficIncidents` part when it lacks it.

---

## Traffic flow overlay

```ts
const trafficFlow = await TrafficFlowModule.get(map, { visible: true });

trafficFlow.setVisible(false);
trafficFlow.isVisible(); // false — the setting; `false` until something shows the flow

// Filter: the fields of `filters` are one filter (all must match); each `any` entry an alternative (OR)
trafficFlow.updateConfig({
    filters: {
        roadCategories: { show: 'only', values: ['motorway', 'trunk', 'primary'] }, // show: 'only' | 'all-except' (filterShowModes)
        any: [{ roadClosures: 'only' }],  // …or any closed road
    },
});
trafficFlow.updateConfig({ filters: { roadSubCategories: { show: 'all-except', values: ['residential'] } } });
trafficFlow.updateConfig({ filters: undefined });  // reset

const unsubscribe = trafficFlow.events.on('click', (segment, lngLat) => { showSpeedInfo(segment.properties.relativeSpeed); });
trafficFlow.events.off('click'); // every click handler of the module
```

- Road categories (`roadCategories`): `motorway`, `motorway_link`, `trunk`, `trunk_link`, `primary`, `primary_link`, `secondary`, `secondary_link`, `tertiary`, `tertiary_link`, `street`, `service`, `track`
- Road subcategories: `street` → `unclassified`, `residential`, `living_street` (`streetRoadSubCategories`); `service` → `parking`, `driveway`, `alley` (`serviceRoadSubCategories`). Only `street` and `service` roads have one, so `roadSubCategories: { show: 'only', … }` drops every other road.
- A values filter applies only with both `show` and `values` set.

### Flow appearance — `colors`, `widthFactor`, `opacityFactor`

```ts
const trafficFlow = await TrafficFlowModule.get(map, { visible: true, colors: { slow: '#f59e0b', stationary: '#7f1d1d' }, widthFactor: 1.5 });
setKnob(trafficFlow, trafficFlowKnobCatalogue, 'colors.free', '#16a34a'); // outline shade re-derived automatically
trafficFlow.updateConfig({ opacityFactor: 0.6 }); // fade the flow under a route
```

- Levels: `free`, `slow`, `queueing`, `stationary`, `closed` (closed roads' outline). Unset, the style's colours.
- `widthFactor`: factor 0.5–2, default `1` — the flow lines only; `roads.widthFactor` (`map-styling.md`) does not reach them.
- `opacityFactor`: factor 0–1, default `1` — the flow lines and their outlines, times the style's own opacity, so its zoom ramp keeps its shape.
- Map-wide colour ids, for `getStyleColor(map, id)` and `bloom.only`: `traffic.flow.colors.slow`, and so on per level.

### Flow as data — what you can and cannot get

> **Orbis flow is vector tiles only.** No service returns live flow for a road, a point or an area: `getRenderedFeatures()` over the current viewport is the whole of flow as data.

```ts
const { trafficFlow: segments } = trafficFlow.getRenderedFeatures();
for (const segment of segments) {
    const { roadCategory, relativeSpeed, roadClosure } = segment.properties;
    // relativeSpeed: 0..1 relative to free flow (always present)
}
```

- **Available:** `relativeSpeed`, `absoluteSpeed` (km/h), `openlr` (OpenLR location reference, a map-agnostic key for the section), `roadCategory`, `roadSubcategory` (on `street` / `service`), `roadClosure`, `leftHandTraffic`, `displayClass`. The SDK requests these tile tags on every flow tile.
- **`partOfTwoWayRoad`:** `true` on a section covering both directions of a two-way road, absent otherwise.
- **Geometry:** `LineString | MultiLineString` (a section a tile draws in several parts). Check `geometry.type` before reading coordinates.
- **Not available anywhere on Orbis:** free-flow speed, travel time, delay in seconds, confidence. Do not promise them.
- Viewport-bound and zoom-dependent, and only what is drawn: a hidden module returns none. A segment crossing a tile boundary comes back once per tile, so de-duplicate on geometry if you export.
- "Export traffic for an area" or "speed per road class" is a **historical** question: use `trafficAreaAnalytics()` (below), not the flow tiles.

---

## Traffic incidents overlay

```ts
const trafficIncidents = await TrafficIncidentsModule.get(map, { visible: true });

// Fields of one filter all apply; `any` entries are alternatives
trafficIncidents.updateConfig({ filters: { magnitudes: { show: 'all-except', values: ['minor'] } } });
// indexedMagnitudes (core): every DelayMagnitude, in the Traffic API's magnitudeOfDelay code order
const allSelected = selectedMagnitudes.length === indexedMagnitudes.length;
trafficIncidents.updateConfig({
    filters: { incidentCategories: { show: 'only', values: ['accident', 'road-closed', 'jam'] } },
});
// required drops incidents reporting no delay; without it, minMinutes keeps them
trafficIncidents.updateConfig({ filters: { delays: { required: true, minMinutes: 5 } } });
trafficIncidents.updateConfig({ filters: { roadCategories: { show: 'only', values: ['motorway', 'trunk'] } } });
trafficIncidents.updateConfig({ filters: undefined });  // reset

// Planned incidents (scheduled roadworks, closures) too; unset or [] is ['present']. Reloads the incident tiles.
trafficIncidents.updateConfig({ timeValidity: ['present', 'future'] });

trafficIncidents.setIconsVisible(false);
trafficIncidents.isIconsVisible();  // false: icons.visible, else isVisible()
trafficIncidents.setVisible(false); // clears icons.visible

trafficIncidents.events.on('click', (incident) => {
    const { id, category, magnitudeOfDelay, delayInSeconds, description, averageSpeedKmph } = incident.properties;
});
```

- Magnitudes (`DelayMagnitude`): `'unknown'`, `'minor'`, `'moderate'`, `'major'`, `'indefinite'`
- Incident categories (`fullTrafficIncidentCategories`, from core): `accident`, `animals-on-road`, `broken-down-vehicle`, `danger`, `flooding`, `fog`, `frost`, `jam`, `lane-closed`, `narrow-lanes`, `other`, `rain`, `road-closed`, `roadworks`, `wind`. `animals-on-road` and `narrow-lanes` are tile-only.
- Road filters: the flow ones above.
- Tile features are `TrafficIncidentsModuleFeature`: `TrafficIncidentBaseProperties` (core) plus `description`, `roadCategory`, `roadSubcategory` (optional: on `street` / `service` only), `averageSpeedKmph`, `timeValidity`, …
- `description` is in the map language, or the nearest the traffic service has (`pt-PT` for `pt-BR`), else English; `map.setLanguage` reloads the incident tiles when that changes.

### Incidents appearance — `colors`, `widthFactor`, `opacityFactor`

```ts
const trafficIncidents = await TrafficIncidentsModule.get(map, { visible: true, colors: { major: '#b91c1c', closed: '#111827' }, widthFactor: 1.5 });
setKnob(trafficIncidents, trafficIncidentsKnobCatalogue, 'colors.minor', '#facc15');
setKnob(trafficIncidents, trafficIncidentsKnobCatalogue, 'opacityFactor', 0.5);
```

- Magnitudes: `minor`, `moderate`, `major`, `closed` (closed roads' outline). Unset, the style's colours.
- `widthFactor`: factor 0.5–2, default `1` — the incident lines.
- `opacityFactor`: factor 0–1, default `1` — the incident lines and their outlines, times the style's own opacity; the icons stay opaque.
- Borrowed: `RoutingModule`'s `traffic` sections and `TrafficIncidentDetailsModule` draw in these colours, live (`map-styling.md` § Borrowed looks).
- Map-wide colour ids, for `getStyleColor(map, id)` and `bloom.only`: `traffic.incidents.colors.major`, and so on per magnitude.

### Whole-config changes

```ts
trafficFlow.applyConfig(newFlowConfig);            // replaces: what it omits returns to its default
trafficIncidents.updateConfig({ widthFactor: 1.2 }); // one level deep: a `filters` passed replaces the whole filter
```

---

## TrafficIncidentDetailsModule — render `trafficIncidentDetails()` results

Data-owned (`create()`, a new instance each call). You fetch incidents via `trafficIncidentDetails()`, hand the result to `show()`, and the module draws the same per-magnitude line + icon look as the tile overlay — driven by *your* snapshot, with the full typed feature on click.

```ts
const incidentDetailsModule = await TrafficIncidentDetailsModule.create(map);

const result = await trafficIncidentDetails({ bbox: map.getBBox(), timeValidityFilter: ['present'] });
await incidentDetailsModule.show(result); // replaces what was shown, clears the focus; fires `shown-features`

// Highlight a subset — wider stripe + theme-aware outline (black on light styles, white on dark),
// unfocused features unchanged unless `highlight.unfocusedOpacityFactor` fades them.
// No-op before show(); kept through a setStyle that keeps state.
incidentDetailsModule.setFocus([result.features[0].properties.id]);

// Any handler makes a hovered or clicked incident draw the same highlight (its `eventState`);
// `incidentDetailsModule.setEventState({ id, state: 'click' })` puts it from your own UI.
// The handler receives the **typed** TrafficIncident (Date / array / object properties preserved).
// `allEventFeatures` (third argument) holds each incident under the pointer once, however many of its layers were hit.
incidentDetailsModule.events.on('click', (incident, lngLat, allEventFeatures) => {
    incidentDetailsModule.setFocus([incident.properties.id]);
});

incidentDetailsModule.setFocus(null);     // clear focus; setFocus([]) does the same
incidentDetailsModule.setVisible(false);  // hide all layers, data kept
incidentDetailsModule.isVisible();        // the visible setting (default true), not whether incidents are drawn
incidentDetailsModule.getShown().incidents; // exactly what show() got — not a viewport query
await incidentDetailsModule.clear();      // drop rendered data (source kept, can show() again)

incidentDetailsModule.updateConfig({ beforeLayerConfig: 'top' });         // pin above every layer
incidentDetailsModule.updateConfig({ beforeLayerConfig: 'lowestLabel' }); // default — below labels
```

### Highlight styling — `IncidentHighlightConfig`, or off

```ts
// widthFactor: default 1.6, clamped to its catalogue range (1–1.8); 1 keeps the outline without widening.
const incidentDetailsModule = await TrafficIncidentDetailsModule.create(map, {
    highlight: { outline: { color: '#0052a5' }, line: { widthFactor: 1.8 } },
});
// `highlight` also changes live — its fields, or `false` — repainting the highlighted incidents in place.
incidentDetailsModule.updateConfig({ highlight: { outline: { color: '#c2185b' }, line: { widthFactor: 1.2 } } });

// Fade every incident outside the focus set — lines, icons and delay text — while a focus is active.
// A factor on their opacity, clamped to 0–1, default 1 (no fade); multiplies `line.opacity`; a hovered or clicked incident stays at full strength;
// it's config, so it survives setStyle() with no re-apply. Don't repaint the module's layers for this.
const focusModule = await TrafficIncidentDetailsModule.create(map, { highlight: { unfocusedOpacityFactor: 0.15 } });
focusModule.setFocus([incidentId]); // the rest fade
focusModule.setFocus(null);         // all back at full strength

// Disable the built-in highlight — for focused, hovered and clicked incidents, and the fade —
// but keep the state writing: drive your own styling off `feature-state.focused`
// and `['get', 'eventState']`.
const incidentDetailsModule = await TrafficIncidentDetailsModule.create(map, { highlight: false });
```

### Line opacity — `line.opacity`

```ts
const incidentDetailsModule = await TrafficIncidentDetailsModule.create(map, { line: { opacity: 0.6 } });
incidentDetailsModule.updateConfig({ line: { opacity: 1 } }); // live
```

- `line.opacity`: number 0–1, default `1` — every incident line, focused or not. The markers and the outline of a highlighted incident stay opaque. To fade only the unfocused incidents, markers included, use `highlight.unfocusedOpacityFactor`.

### Layer overrides — `layers`

A partial MapLibre layer per layer the module draws, bottom to top (`TrafficIncidentDetailsLayersConfig`): `highlightHalo`, `outline`, `innerSolid`, `innerChevron`, `innerPattern`, `incidentMarker`, `jamMarker`, `closedRoadMarker`. `paint`/`layout` merge per property and win over the incident colours and the highlight; a `beforeID` is ignored; `layout.visibility: 'none'` keeps that layer hidden while the module is shown.

```ts
incidentDetailsModule.updateConfig({
    layers: { incidentMarker: { minzoom: 11 }, jamMarker: { layout: { 'text-field': '' } } },
});
```

### Colours follow the incident knobs

The details module draws each magnitude in the colour the style gives its incident tiles, so `TrafficIncidentsModule`'s `colors.*` knobs recolour it live. No other knob reaches it (`map-styling.md` § Borrowed looks).

### When to hide the tile module first

The tile `TrafficIncidentsModule` is hidden until shown, so the details module renders on its own. If the app shows the tile module, hide it before showing fetched incidents, or each incident draws twice:

```ts
const tileIncidents = await TrafficIncidentsModule.get(map);
tileIncidents.setVisible(false);

const incidentDetailsModule = await TrafficIncidentDetailsModule.create(map);
await incidentDetailsModule.show(await trafficIncidentDetails({ bbox: map.getBBox() }));
```

### Differences vs. `TrafficIncidentsModule` (the tile module)

| Aspect | `TrafficIncidentsModule` | `TrafficIncidentDetailsModule` |
|---|---|---|
| Source type | Vector tiles (`style`) | GeoJSON you fetch (`geojson`) |
| Data acquisition | Built into the map style | `await trafficIncidentDetails(...)` then `incidentDetailsModule.show(result)` |
| Click payload | Tile feature (`TrafficIncidentsModuleFeature`) | Typed `TrafficIncident` with `Date` / array / object fields preserved |
| Filtering | `filters` config (`magnitudes`, `incidentCategories`, `delays`, road filters) | Filter the service request (`categoryFilter`, `timeValidityFilter`) or the response before `show()` |
| Highlight subset | — | `setFocus(ids)` — wider stripe + outline, MapLibre `feature-state.focused`; a hovered or clicked incident draws the same; `highlight.unfocusedOpacityFactor` fades the rest |
| Per-road-class width / offset, declutter | Yes (road-classification tags in tiles) | No — uniform stripe (REST API has no `road_category`); only the icons of shorter delays wait for a higher zoom |
| Use when | "Just show me live traffic" | App needs the structured data (ids, delays, geometry) and renders exactly that |

---

## Map click or route section → fetch incident details

```ts
// A live tile incident's id is the id the service takes
trafficIncidents.events.on('click', async (incident) => {
    const result = await trafficIncidentDetails({ ids: [incident.properties.id] });
    const props = result.features[0]?.properties;
    if (!props) return;
    showIncidentPanel({
        type: props.category,
        severity: props.magnitudeOfDelay,
        delay: props.delayInSeconds,
        from: props.from,
        to: props.to,
        start: props.startTime, // Date | undefined
        end: props.endTime,     // Date | undefined
    });
});

// A route traffic section's incident: getSectionBBox is from core
for (const section of route.properties.sections.traffic ?? []) {
    const { eventId } = section;
    const bbox = getSectionBBox(route, section);
    if (!eventId || !bbox) continue;
    const incidents = await trafficIncidentDetails({ bbox });
    const incident = incidents.features.find(({ properties }) => properties.id.endsWith(eventId));
}
```

- **Never pass `eventId` as `ids`**: the routing service returns a bare `TTR…`-style id, while
  `trafficIncidentDetails` indexes incidents as `TTI-<uuid>-TTR…`, and that prefix varies per incident.
  The lookup answers 200 with an empty `FeatureCollection`, no error.
- **One section per query**: a whole route's bbox can exceed the service's 10,000 km² limit.

---

## trafficIncidentDetails service — query by area

```ts
// Current map viewport
const incidents = await trafficIncidentDetails({ bbox: map.getBBox() });

// A geocoded place (accepts any GeoJSON object, or a [w, s, e, n] tuple)
const place = await geocodeOne('Amsterdam');
const incidents = await trafficIncidentDetails({ bbox: place });

// Filtered query
const incidents = await trafficIncidentDetails({
    bbox: map.getBBox(),
    categoryFilter: ['accident', 'jam', 'road-closed'], // trafficIncidentRequestCategories
    timeValidityFilter: ['present', 'future'],          // default: ['present']
});

// Within a city boundary rather than its bounding box: the request covers the polygon's bbox and
// the response keeps only the incidents that intersect the polygon
const incidents = await trafficIncidentDetails({ polygon: await geometryData({ geometries: [place] }) });

incidents.features.forEach((incident) => {
    const { category, magnitudeOfDelay, from, to, delayInSeconds, lengthInMeters, startTime, endTime } =
        incident.properties;
    const geometry = incident.geometry; // Point or LineString
});
```

- `categoryFilter` takes `trafficIncidentRequestCategories` (`TrafficIncidentRequestCategory`): `accident`, `broken-down-vehicle`, `danger`, `flooding`, `fog`, `frost`, `jam`, `lane-closed`, `other`, `rain`, `road-closed`, `roadworks`, `wind` — not the tile-only `animals-on-road` / `narrow-lanes`.
- No magnitude parameter: filter the response on `magnitudeOfDelay`.
- `ids`: up to 100; more than 5 go as a POST, which the SDK picks.
- No past incidents: `timeValidityFilter` takes `present` and `future` only, and no TomTom API serves the incidents in force on an earlier day.

---

## trafficAreaAnalytics — historical metrics for a region

> Unavailable on Freemium and Pay As You Grow (PAYG): it takes a TomTom MOVE Portal API key, not the Maps key (see [Gotchas](#gotchas)). A MOVE account comes with a 30-day free trial — point a developer without that key to https://move.tomtom.com/register?source_app=b2b&source_product=area-analytics, or, with an account already, to https://move.tomtom.com/. The key is in the MOVE Portal menu once logged in. Product overview: https://docs.tomtom.com/area-analytics/documentation/product-information/introduction

```ts
// 1. Get city boundary
const geocodeResult = await geocodeOne('Amsterdam, Netherlands');
const boundary = await geometryData({ geometries: [geocodeResult] });

// 2. Query analytics
const analytics = await trafficAreaAnalytics({
    apiKey: MOVE_PORTAL_KEY,
    startDate: '2024-08-01',
    endDate:   '2024-08-07',          // 1–31 days after startDate; use days: [] for non-consecutive
    metrics: ['speed', 'congestionLevel', 'freeFlowSpeed', 'travelTime'],  // or 'all'
    functionalRoadClasses: ['MOTORWAY', 'MAJOR_ROAD', 'SECONDARY_ROAD'],  // or 'all'; the importable `functionalRoadClasses` lists every class
    hours: [5, 6, 7, 15, 16],         // UTC: Amsterdam's rush hours in summer time (UTC+2), or 'all'
    geometry: boundary.features[0].geometry,
});

// 3. Access results
analytics.properties.ranges.congestionLevel; // { min, max } over the tiles
const region = analytics.features[0].properties;

const { speed, congestionLevel, freeFlowSpeed, travelTime } = region.baseData;

// Each granularity has its own entry type (AreaAnalyticsDailyEntry, AreaAnalyticsHourlyEntry, ...) with its time
// identifiers always set. `date` is midnight UTC; `hourly` spans every day of the range, so read `date` with `hour`.
region.timedData.daily?.forEach((entry) => {
    console.log(entry.date.toISOString().slice(0, 10), entry.speed, entry.congestionLevel);
});
region.timedData.hourly?.forEach((entry) => {
    console.log(entry.date.toISOString().slice(0, 10), entry.hour, entry.speed);
});
// Average week, Monday first: day 1 (Monday)–7 (Sunday) and hour 0–23 per entry, in UTC. Only buckets with
// data appear (fewer than 168 for a short range or an `hours` filter), so filter on day/hour, never index.
region.timedData.average?.forEach((entry) => {
    console.log(entry.day, entry.hour, entry.congestionLevel);
});

region.tiledData?.tiles.forEach((tile) => {
    const [lon, lat] = tile.tileCentre;
    console.log(`[${lon}, ${lat}]: congestion=${tile.congestionLevel}%`);
});
```

Metrics (`metrics`, `areaAnalyticsMetricKeys`): `'speed'` (km/h), `'freeFlowSpeed'` (km/h), `'congestionLevel'` (%), `'travelTime'` (minutes per 10 km), `'networkLength'` (m), or `'all'` for all five

Functional road classes: `'MOTORWAY'`, `'MAJOR_ROAD'`, `'OTHER_MAJOR_ROAD'`, `'SECONDARY_ROAD'`, `'LOCAL_CONNECTING_ROAD'`, `'LOCAL_ROAD_HIGH_IMPORTANCE'`, `'LOCAL_ROAD'`, `'LOCAL_ROAD_MINOR_IMPORTANCE'`, `'OTHER_ROAD'` (`result.properties.frcs` echoes them as indices 0–8)

Values are per region and per tile, never per road segment, and there are no vehicle counts. Per-segment speeds by date and hour come from MOVE Traffic Stats (https://docs.tomtom.com/traffic-stats/documentation/product-information/introduction), an asynchronous job API the SDK doesn't wrap: call it directly with the MOVE Portal key.

---

## TrafficAreaAnalyticsModule — map visualization

Renders the `trafficAreaAnalytics` response on the map. Five modes: `'hexgrid-3d'` (default), `'hexgrid-2d'`, `'square-3d'`, `'square-2d'`, `'heatmap'`. `show()` renders **all** tiles and regions in the response; ask for `metrics: 'all'` to switch `activeMetric` without refetching.

```ts
import { TrafficAreaAnalyticsModule } from '@tomtom-org/maps-sdk/map';
import { trafficAreaAnalytics, geocodeOne, geometryData } from '@tomtom-org/maps-sdk/services';

// 1. Get region boundary
const place = await geocodeOne('Amsterdam, Netherlands');
const boundary = await geometryData({ geometries: [place] });

// 2. Create module
const analyticsModule = await TrafficAreaAnalyticsModule.create(map, {
    displayMode: 'hexgrid-3d',        // 'hexgrid-3d' | 'hexgrid-2d' | 'square-3d' | 'square-2d' | 'heatmap'
    activeMetric: 'congestionLevel',  // which metric drives color + height
    metrics: {
        congestionLevel: { palette: 'trafficLight' },
        speed: { palette: 'heat' },
    },
});
// From here on, getConfig() holds displayMode, activeMetric and every metric's palette and height, defaults filled in
// (a height you pass replaces the default whole, its unset fields left out);
// a field a setter clears with undefined is left out until the next applyConfig, updateConfig or knob write

// 3. Fetch and display
const analytics = await trafficAreaAnalytics({ ... });
await analyticsModule.show(analytics);  // fires `shown-features` with the response

// Dynamic updates
analyticsModule.updateConfig({ displayMode: 'hexgrid-2d' }); // switch visualization mode
analyticsModule.updateConfig({ activeMetric: 'speed' });     // switch active metric
analyticsModule.setPalette('heat');                   // palette for all metrics
analyticsModule.setPalette('heat', ['speed', 'freeFlowSpeed']); // palette for specific metrics
analyticsModule.setColorStops(                        // custom stops for all metrics; win over the palette
    { scaleMode: 'raw', stops: [{ value: 0, color: '#00ff00' }, { value: 100, color: '#ff0000' }] },
);
analyticsModule.setColorStops(undefined);             // clear the stops: back to the palette
analyticsModule.setPalette(undefined);                // clear the palette: 'trafficLight'
// The stops a metric paints with (its colorStops, else its palette spread 0–100 %): for a legend that follows the config
const { stops } = resolveColorStops('speed', analyticsModule.getConfig()?.metrics?.speed); // from '@tomtom-org/maps-sdk/map'
analyticsModule.setHeight({ maxMeters: 200 });        // height for all metrics (predefinedRange default)
analyticsModule.setHeight({ scaleMode: 'currentRange', maxMeters: 500 }, ['speed']); // specific metrics
analyticsModule.setHeight({ scaleMode: 'raw', metersPerUnit: 10 });  // raw: metric value × metersPerUnit metres
analyticsModule.setHeight(undefined, ['speed']);      // clear the height: the metric's default
analyticsModule.setFilters({ min: 20, max: 80 });     // filter cells by value range (all metrics)
analyticsModule.setFilters({ min: 50 }, ['congestionLevel']); // filter specific metric
analyticsModule.setFilters(undefined);                // clear all filters
analyticsModule.setVisible(false);
analyticsModule.isVisible();                          // the visible setting (default true), not whether tiles are drawn
await analyticsModule.clear();

// Whole-config changes
analyticsModule.applyConfig({ displayMode: 'heatmap' }); // replaces: everything omitted back to its default
analyticsModule.updateConfig({ activeMetric: 'speed' }); // keeps the rest; a metrics passed replaces the whole record

// Region boundary appearance (always shown alongside analytics cells)
const analyticsModule = await TrafficAreaAnalyticsModule.create(map, {
    regionPolygon: { color: '#0052a5', fill: { style: 'inverted', opacity: 0.08 }, line: { opacity: 1, width: 3 } },
});

// Layer ordering — one target for every display mode, or a record keyed by display mode
// ('heatmap' | 'hexgrid-2d' | 'hexgrid-3d' | 'square-2d' | 'square-3d') plus `all` for the rest.
const analyticsModule = await TrafficAreaAnalyticsModule.create(map, {
    beforeLayerConfig: { all: 'lowestLabel', 'hexgrid-3d': 'lowestPlaceLabel', 'square-3d': 'lowestPlaceLabel' },
});
analyticsModule.updateConfig({ beforeLayerConfig: { 'hexgrid-3d': 'top' } }); // a mode it leaves out goes back to its default
// Defaults: heatmap and 2D modes below 'lowestLabel', 3D modes below 'lowestPlaceLabel'; the region always below labels.
// A target the style lacks (satellite has no `lowestRoadLine` or `lowestBuilding`) puts that mode's layers on top;
// a missing `lowest3D` goes under the POIs first.

// Layer overrides — a partial MapLibre layer per layer, merged over the module's own (which they win over)
analyticsModule.updateConfig({
    layers: {
        hexgridFill: { paint: { 'fill-opacity': 0.85 } },
        hexgridExtrusion: { paint: { 'fill-extrusion-vertical-gradient': false } },
        regionLine: { paint: { 'line-dasharray': [2, 2] } },
    },
});

// Events — fire on what the active mode draws: hexgrid or square cells, or the heatmap's tile-centre points; each is an AreaAnalyticsTileFeature
analyticsModule.events.on('click', (cell, lngLat) => {
    console.log(cell.properties.congestionLevel, cell.properties.speed);
});
analyticsModule.events.on('hover', (cell) => { });
analyticsModule.events.on('config-change', (config) => {
    console.log('Active metric:', config?.activeMetric);
});
analyticsModule.events.off('click');

// Query shown data
const { heatmap, hexgrid, square } = analyticsModule.getShown();
```

Metrics: `'congestionLevel'`, `'speed'`, `'travelTime'`, `'freeFlowSpeed'`, `'networkLength'` (road length per tile in metres — road density indicator; its palette and default height span the loaded range)
Modes: `'hexgrid-3d'` (default), `'hexgrid-2d'`, `'square-3d'`, `'square-2d'`, `'heatmap'`
Palettes (`areaAnalyticsPalettes`, type `AreaAnalyticsPalette`), good → bad: `'trafficLight'` (default), `'heat'`, `'monochrome'`, `'viridis'`, `'plasma'`. A palette spans the metric's predefined range (`networkLength`: the loaded range), reversed for `speed` / `freeFlowSpeed`; `getConfig()` keeps the name. `colorStops` wins over `palette` and is used as given, never reversed (an empty `stops` leaves the palette painting); stops may come in any order (sorted by value, the last given winning a shared value). Each setter writes only its own field.
`colorStops.scaleMode` (`AreaAnalyticsScaleMode`, shared with the height): `'raw'` (default) — actual metric values; `'predefinedRange'` — 0–100% of the SDK's range (congestion 0–100, speed and freeFlowSpeed 0–120 km/h, travelTime 0–20 min per 10 km, networkLength 0–5000 m); `'currentRange'` — 0–100% of the loaded data's range. The heatmap colours its density instead, spreading the stops over it whatever the mode (percentage stops from 0 to 100, `'raw'` stops from their lowest value to their highest)
Height scaleMode: `'predefinedRange'` (default; `'currentRange'` for `networkLength`) / `'currentRange'` — use `maxMeters` (default 1000), the height of a cell at the top of the range and the ceiling; `'raw'` — use `metersPerUnit` (metres per unit of the metric, default 1). On `speed`, cells rise as speed drops.
`layers` (`TrafficAreaAnalyticsLayersConfig`), drawn per mode: `heatmap`; `hexgridFill` + `hexgridOutline` (hover/click outline) in `hexgrid-2d`; `hexgridExtrusion` + `hexgridExtrusionHighlight` in `hexgrid-3d`; the same four `square*`; `regionFill` + `regionLine` always. A cell layer's `filter` is ANDed with the active metric's `filters`; an extrusion highlight follows its extrusion's height; a `beforeID` is ignored; `layout.visibility: 'none'` keeps that layer hidden in its mode.

---

## Every knob as data — the traffic knob catalogues

Each traffic module's plain-valued settings, static and readable with no map: kind (`toggle` /
`factor` / `number` / `color` / `enum` / `enums`), `range` or `options`, and `default` where one value
holds everywhere. The id is the setting's path in the module's config; each `…KnobIds` array lists
the ids in catalogue order, `…KnobId` is their union and `…KnobValueOf<ID>` the plain value one takes.

```ts
import { trafficAreaAnalyticsKnobCatalogue, type TrafficAreaAnalyticsKnobValueOf } from '@tomtom-org/maps-sdk/map';

const knob = trafficAreaAnalyticsKnobCatalogue.find(({ id }) => id === 'displayMode');
// { id: 'displayMode', kind: 'enum', description: '…', options: ['hexgrid-3d', …, 'heatmap'], default: 'hexgrid-3d' }
const mode: TrafficAreaAnalyticsKnobValueOf<'displayMode'> = 'heatmap';
```

- The flow and incident catalogues hold visibility, filters and the look: `colors.*`,
  `widthFactor` and `opacityFactor` (§ Flow appearance, § Incidents appearance).
- Their `filters.…` knobs set the fields of `filters`, one filter; `filters.any`, further filters
  a feature may match instead (combined with OR), is config only. Each `….show` (`only` /
  `all-except`) goes with its `….values`; neither has a default — unset, nothing is filtered.
- Set, read and reset one by id with `setKnob` / `getKnob` / `resetKnob`; entry shape and kinds: `map-setup.md` § Every setting as data.

### `trafficFlowKnobCatalogue`

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `false` |
| `filters.roadCategories.show` | enum, `only` / `all-except` | — |
| `filters.roadCategories.values` | enums, `roadCategories` | — |
| `filters.roadSubCategories.show` | enum, `only` / `all-except` | — |
| `filters.roadSubCategories.values` | enums, `streetRoadSubCategories` then `serviceRoadSubCategories` | — |
| `filters.roadClosures` | enum, `only` / `all-except` | — |
| `colors.free`, `colors.slow`, `colors.queueing`, `colors.stationary`, `colors.closed` | color | — the style's |
| `widthFactor` | factor, 0.5–2 | `1` |
| `opacityFactor` | factor, 0–1 | `1` |

### `trafficIncidentsKnobCatalogue`

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `false` |
| `icons.visible` | toggle | unset follows `visible` |
| `timeValidity` | enums, `present` / `future` | `['present']` |
| `filters.roadCategories.show`, `filters.roadCategories.values` | as on flow | — |
| `filters.roadSubCategories.show`, `filters.roadSubCategories.values` | as on flow | — |
| `filters.incidentCategories.show` | enum, `only` / `all-except` | — |
| `filters.incidentCategories.values` | enums, `fullTrafficIncidentCategories` | — |
| `filters.magnitudes.show` | enum, `only` / `all-except` | — |
| `filters.magnitudes.values` | enums, `unknown` / `minor` / `moderate` / `major` / `indefinite` | — |
| `filters.delays.required` | toggle | `false` |
| `filters.delays.minMinutes` | number, 0–120 | — |
| `colors.minor`, `colors.moderate`, `colors.major`, `colors.closed` | color | — the style's |
| `widthFactor` | factor, 0.5–2 | `1` |
| `opacityFactor` | factor, 0–1 | `1` |

### `trafficIncidentDetailsKnobCatalogue`

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `true` |
| `highlight.outline.color` | color | black on light styles, white on dark |
| `highlight.line.widthFactor` | factor, 1–1.8 | `1.6` |
| `highlight.unfocusedOpacityFactor` | factor, 0–1 | `1` |
| `line.opacity` | number, 0–1 | `1` |

Not in it: `beforeLayerConfig`, `layers`, and `highlight: false`, which turns the highlight off. The
incident lines take the style's incident colours, which `TrafficIncidentsModule`'s `colors.*` knobs
set.

### `trafficAreaAnalyticsKnobCatalogue`

Module-wide knobs first, then the same seven for each metric (`<metric>` is any of
`areaAnalyticsMetricKeys`).

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `true` |
| `displayMode` | enum | `'hexgrid-3d'` |
| `activeMetric` | enum, `areaAnalyticsMetricKeys` | `'congestionLevel'` |
| `regionPolygon.color` | color | black on light styles, white on dark |
| `regionPolygon.fill.style` | enum, `'filled'` / `'inverted'` | `'filled'` |
| `regionPolygon.fill.opacity` | number, 0–1 | `0` |
| `regionPolygon.line.opacity` | number, 0–1 | `0.5` |
| `regionPolygon.line.width` | number, 0–10 px | `2` |
| `metrics.<metric>.palette` | enum, `areaAnalyticsPalettes` | `'trafficLight'` |
| `metrics.<metric>.height.scaleMode` | enum, `'predefinedRange'` / `'currentRange'` / `'raw'` | `'predefinedRange'`; `'currentRange'` for `networkLength` |
| `metrics.<metric>.height.maxMeters` | number, 0–5000 m | `1000` |
| `metrics.<metric>.height.minMeters` | number, 0–5000 m | `0` |
| `metrics.<metric>.height.metersPerUnit` | number, 0–100 m per unit, `raw` scale mode only | `1` |
| `metrics.<metric>.filters.min` | number, the metric's predefined range | — |
| `metrics.<metric>.filters.max` | number, the metric's predefined range | — |

A metric's filters hide cells only while it is the `activeMetric`, and never in the heatmap. Their
range is the one the module scales colours and heights over, not a bound on the data: real values
can exceed it.

`maxMeters` applies in the `predefinedRange` and `currentRange` scale modes, `metersPerUnit`
(metres per unit of the metric) in `raw`. Heights, `metersPerUnit`, line width and the filters have
`hard-min` ranges (map-setup.md): a larger value than `max` still applies.

Not in it: `colorStops` (set them through `setColorStops` or the config), `beforeLayerConfig` and `layers`.

---

## When to use which option

| API | Data | Use case |
|---|---|---|
| `TrafficFlowModule` | Real-time speed overlay (vector tiles) | Visual speed conditions on map |
| `TrafficIncidentsModule` | Real-time incident lines and icons (vector tiles) | Toggle / filter live events; no fetch needed |
| `trafficIncidentDetails` | Structured incident data (REST) | Programmatic queries; full typed feature in your app |
| `TrafficIncidentDetailsModule` | Renders a `trafficIncidentDetails()` result | Render exactly what you fetched, with `setFocus()` highlight and typed click payloads |
| `trafficAreaAnalytics` | Historical aggregates | Dashboards, reports, trend analysis |
| `TrafficAreaAnalyticsModule` | Historical aggregates on map | Visualize region analytics with hex/square/heatmap |

---

## Gotchas

- There is no `filter()` method: reset a tile module's filters with `updateConfig({ filters: undefined })`. `TrafficIncidentDetailsModule` has no `filters`; filter the service request or the response instead
- The fields of one `filters` object all apply (AND), each `filters.any` entry is an alternative (OR); magnitude and category filters in one object combine as AND
- `TrafficIncidentsModule` filters narrow the incident lines and their icons alike; `icons` only decides whether the icons show (`icons: { visible }`, `setIconsVisible`, read back with `isIconsVisible()`, which is `isVisible()` while `icons.visible` is unset)
- `TrafficIncidentsModule.setVisible()` clears `icons.visible`, so the icons follow `visible` again. Icons alone are `{ visible: false, icons: { visible: true } }`, or `setVisible(false)` and then `setIconsVisible(true)` — in the other order the icons hide again
- `events.off(type)` takes no handler and removes every handler of that type on the module; to remove one, call the function `events.on` returned
- `trafficIncidentDetails` writes `events` descriptions in the call's `language`, or the nearest the traffic service has (`pt-PT` for `pt-BR`), else English
- `trafficIncidentDetails` bbox accepts `[w, s, e, n]` or any GeoJSON object; the area is at most 10,000 km²
- `trafficIncidentDetails` takes exactly one of `bbox`, `polygon` or `ids`. `polygon` accepts a `Polygon`/`MultiPolygon`, a `Feature` or a `FeatureCollection` of them (what `geometryData` returns); a `LineString` incident crossing the boundary is kept, and the 10,000 km² limit applies to the polygon's bbox
- `TrafficIncidentDetailsModule` and `TrafficIncidentsModule` both draw incidents. The tile module is hidden until shown, so they don't collide by default — but if the app shows the tile module, hide it (`tileIncidents.setVisible(false)`) before showing fetched incidents
- `isVisible()` on every traffic module reports the `visible` setting: `true` on a `TrafficIncidentDetailsModule` or Area Analytics module showing nothing, and `false` on `TrafficIncidentsModule` set hidden with `icons: { visible: true }`, whose icons still draw (`isIconsVisible()` reads their setting, `true` there). To know whether data is drawn, read `getShown()` (`getRenderedFeatures()` on flow and incidents); for a layer itself, `map.mapLibreMap.getLayoutProperty(layerId, 'visibility')`
- `TrafficIncidentDetailsModule.show()` clears the focus; `setFocus` before the first `show()` does nothing
- `TrafficIncidentDetailsModule` click handlers receive the *typed* `TrafficIncident` (Date / array / object properties preserved) — not the flattened MapLibre feature
- Stacked incidents on `TrafficIncidentDetailsModule`: MapLibre's symbol collision keeps only the icon of the longest delay visible, so hover/click can't reach the others. Query the `FeatureCollection` you passed to `show()` directly when you need every incident at a point
- `TrafficAreaAnalyticsModule.applyConfig` replaces the configuration, and `updateConfig({ metrics })` replaces the whole per-metric record — to change one metric and keep the others, use `setPalette` / `setColorStops` / `setHeight` / `setFilters` with that metric (`setPalette('heat', ['speed'])`). `AREA_ANALYTICS_DEFAULTS` holds every default, to read or spread as a base
- `trafficAreaAnalytics` requires either `startDate` (+ optional `endDate`) or `days` — not both; `endDate` must be 1 to 31 UTC calendar days after `startDate`, so `startDate` equal to `endDate` fails validation, and so does a `startDate` more than 34 days ago with `endDate` omitted
- `trafficAreaAnalytics` `timedData.weekly` entries count `week` in the ISO 8601 year, which `year` holds: the week from Monday 30 December 2024 is `{ year: 2025, week: 1 }`
- `trafficAreaAnalytics` `anomalies` is keyed by metric (`anomalies.speed`); each anomaly is a run of UTC hours whose `endDate` is the hour after the last one, and its `labels` are the names of the public holidays it overlaps. It is currently always empty: the service detects anomalies only over 35 days or more, beyond a request's 31-day limit
- `trafficAreaAnalytics` `endDate` and every `days` entry must be at least 2 days before today (e.g., if today is `2024-03-18`, latest valid `endDate` is `'2024-03-16'`); an omitted `endDate` defaults to 3 days before today, the latest date that always has data
- `trafficAreaAnalytics` requires a **MOVE Portal API key** (different from standard TomTom API key, 30-day free trial on a new MOVE account); a `401`/`403` on this service means the Maps key went out. Keep the Maps key in `TomTomConfig` and override per-call: `trafficAreaAnalytics({ apiKey: MOVE_PORTAL_KEY, ... })` — see `services-config.md` § Per-call overrides
