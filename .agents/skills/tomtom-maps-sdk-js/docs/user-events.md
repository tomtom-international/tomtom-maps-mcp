# User Interaction Events Reference

## Imports

```ts
import { TomTomMap, BaseMapModule, PlacesModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
```

---

## Event types

Every module that draws features has `events.on(type, handler)`:

| Type | Fires when |
|------|-----------|
| `'click'` | A feature is clicked or tapped |
| `'contextmenu'` | A feature is right-clicked |
| `'hover'` | The pointer arrives on a feature, or moves on to another one |
| `'hover-move'` | The pointer moves along the feature it is already on (every move) |
| `'long-hover'` | The pointer rests on a feature for the long-hover delay |

```ts
const unsub = placesModule.events.on('click', (feature, lngLat, allEventFeatures, sourceWithLayers) => { });
unsub();                            // removes THAT handler
placesModule.events.off('click');   // removes ALL click handlers of the module
```

- `on` appends: several handlers for one type all fire. To replace, `off(type)` then `on`.
- Lifecycle events (`config-change`, `shown-features`) share the same `on` / `off` (`module-events.md`).

## Handler signature

```ts
(
  feature: T,                      // the module's type; GeoJSON modules hand back the feature as shown, props not stringified
  lngLat: LngLat,                  // may be a few px off the feature with precisionMode 'box'
  allEventFeatures: T[],           // this module's features at the point, de-duplicated; [0] is the top-most
  sourceWithLayers: SourceWithLayers,
) => void
```

- Omit trailing args you don't need. For modules with a mapping (POIs, traffic tiles, Places `entryPoints`, Routing `countryCrossings`), `feature` is the mapped shape and `allEventFeatures[0]` its raw form.
- `allEventFeatures` covers the firing module only. Every feature at the point, all modules and the base map, with `.source` / `.layer` — project first, `queryRenderedFeatures(lngLat)` silently queries the whole viewport:

```ts
const p = map.mapLibreMap.project(lngLat);
const all = map.mapLibreMap.queryRenderedFeatures([[p.x - 5, p.y + 5], [p.x + 5, p.y - 5]]);
```

## Event priority (layer order)

The top-most feature under the pointer picks the one module (and scope) that receives the event; it does not bubble to lower layers. Layer order comes from the style and each module's `beforeLayerConfig`, not from creation order. Hidden and collision-culled features receive nothing; nothing fires while the map moves.

---

## Map-level event config (all modules)

```ts
const map = new TomTomMap({
    mapLibre: { container: 'map' },
    events: {
        precisionMode: 'box',              // default; 'point' = exact pixel; 'point-then-box' = pixel, then box if empty
        paddingBoxPx: 5,                   // default; box half-size, ignored with 'point'
        cursorOnHover: 'pointer',          // default; over a feature a handler covers
        cursorOnMap: 'default',            // default; anywhere else
        cursorOnMouseDown: 'grabbing',     // default
        longHoverDelayAfterMapMoveMS: 800, // default; first long-hover after the map moved
        longHoverDelayOnStillMapMS: 300,   // default; next long-hovers on a still map
        hoverGracePeriodMS: 400,           // default; how long a left feature stays 'recently-hovered'
    },
});

// At runtime: merges, omitted keys keep their value; module overrides stay; running timers keep their delay
map.updateEventsConfig({ longHoverDelayOnStillMapMS: 600, hoverGracePeriodMS: 1000 });
```

## Module-level override

A module's `events` (`EventHandlerConfig`) overrides `cursorOnHover` and `hoverGracePeriodMS` for its features:

```ts
const places = await PlacesModule.create(map, {
    events: { cursorOnHover: 'crosshair', hoverGracePeriodMS: 0 },
});
```

A handler keeps the module `events` config in force when `on` registered it: set it at `create` / `get`, or re-register after changing it.

---

## Scoping events

`events.where(scope, config?)` returns events for part of a module, with its own `EventHandlerConfig` — how two parts of one module get different cursors.

```ts
// Feature predicate — every module
trafficIncidents.events.where((incident) => incident.properties.magnitudeOfDelay === 'major')
    .on('click', showIncidentDetails);

// Layer groups — BaseMapModule only; `features` narrows within them in the same call
baseMap.events
    .where({
        layerGroups: { show: 'only', values: ['roadLabels'] },
        features: (feature) => feature.properties.name?.startsWith('A'),
    }, { cursorOnHover: 'pointer' })
    .on('click', showRoadName);

// A named scope narrows the same way
routing.events.tunnels.where((section) => section.properties.routeState === 'selected')
    .on('click', showTunnel);
```

- A predicate filters the whole stack under the pointer and promotes the first match to `feature`; with no match the handler is not called.
- `where()` returns plain `UserEvents`: no lifecycle events, no event-state methods.

## Named scopes

A module drawing several kinds of feature has one scope per kind on `events` — same `on` / `off` / `where`. `module.events` covers all of them plus the lifecycle events; scopes carry user events only.

| Module | Scopes |
|---|---|
| `RoutingModule` | `mainLines`, `waypoints`, `summaryBubbles`, `countryCrossings`, `incidents`, `vehicleRestricted`, `ferries`, `tollRoads`, `tunnels`, `instructionLines`, one `<type>Sections` per generated section type (`urbanSections`, `motorwaySections`, …) |
| `PlacesModule` | `places` (typed `Place`), `connections`, `entryPoints` |
| `GeometriesModule`, `ReachableRangesModule` | `geometry`, `geometryLabel` |
| `CustomGeoJSONModule` | your `sources` keys |

```ts
routing.events.mainLines.on('click', (route) => routing.selectRoute(route.properties.index));
routing.events.waypoints.on('hover', (waypoint, lngLat) => { });
places.events.places.on('click', (place) => showDetails(place)); // places.events also covers connections + entry points
```

BaseMap, POIs, TrafficFlow, TrafficIncidents, TrafficIncidentDetails, TrafficAreaAnalytics have no named scopes — `events` already is the one scope. `TerrainModule` and `StylingFoundationsModule` have `config-change` only.

---

## Background clicks — `BaseMapModule`

The base map is under everything, so its handlers get what no module above takes (deselect, close popup, reverse geocode):

```ts
const baseMap = await BaseMapModule.get(map, {
    events: { cursorOnHover: 'default' }, // otherwise the whole map shows the pointer cursor
});
baseMap.events.on('click', (feature, lngLat) => clearSelection());

// Interactive vs background: two scopes over the one shared module
const names = ['roads', 'buildings3D'];
baseMap.events.where({ layerGroups: { show: 'only', values: names } }, { cursorOnHover: 'pointer' })
    .on('click', (feature) => showFeatureDetails(feature));
baseMap.events.where({ layerGroups: { show: 'all-except', values: names } }, { cursorOnHover: 'default' })
    .on('click', () => clearAllSelections());
```

---

## Event states — select, highlight and read back features

A click, contextmenu, hover or long-hover on a feature a handler covers writes `properties.eventState` on it (`recently-hovered` after the pointer leaves). Every data-owned module — PlacesModule, RoutingModule, GeometriesModule, ReachableRangesModule, CustomGeoJSONModule, TrafficIncidentDetailsModule, TrafficAreaAnalyticsModule — has four methods to put, clean and read them (e.g. sync a list with the map):

```ts
routing.setEventState({ id: routeID, state: 'click' });           // mode 'put' (default) moves it off any other route
routing.setEventState({ index: 0, state: 'hover', mode: 'add' }); // 'add' keeps the others' states
routing.setEventState({ index: 1, state: 'hover', show: false }); // show: false defers the redraw, for batches
routing.clearEventState({ id: routeID });
routing.clearEventStates({ states: ['hover'] });                  // or () for every state
const { click: [selectedID] = [], hover = [] } = routing.getEventStates(); // ids by state, user's and yours; absent = none
```

- The module methods act on exactly what `getShown()` returns as main features — Places `places` (clustered or not), Routing `mainLines`, Geometries / ReachableRanges `geometry`, Custom every source, TrafficIncidentDetails `incidents`, TrafficAreaAnalytics `hexgrid` + `square` + `heatmap`. An id from `getShown()` or a handler is an id they take.
- `id` matches `properties.id`, else the top-level `id` (string or number). `index` is the position in that collection; with several sources, each counts its own.
- Named scopes have the same four methods for their own features (`UserEventsWithStates`): `routing.events.waypoints.setEventState(...)`, `places.events.entryPoints`, `custom.events.<source>` — use the scope when ids repeat across sources.
- A user click/contextmenu clears `click` + `contextmenu` from the other features of the source it lands on; a user hover clears `hover` + `hover-move` + `long-hover` — yours included, so a selection put in code moves on the next click. To let clicks add up, re-put the earlier ids with `mode: 'add'` in the click handler.
- Default hovered/clicked look (one for both): place pins larger, label in `color`, plus entry points; routes a wider outline; geometries and range bands a denser fill and wider border in their own colour; details-module incidents a wider stripe over an outline; area-analytics cells outlined. Custom layers draw only what you style by `['get', 'eventState']`.
- Tuning: Routing `highlight.outline.widthFactor` (default 1.2, range 1–1.25), and for the ring `setSectionFocus` draws `highlight.section.outline.color` (unset: black on light, white on dark) and `highlight.section.outline.widthFactor` (1, 0.5–2); Geometries / ReachableRanges `highlight.fill.opacityFactor` (2, 1–4) and `highlight.line.widthFactor` (1.75, 1–3) — catalogue knobs multiplying the opacity and width in force; `1` turns that look off. Details module `highlight.outline.color` and `highlight.line.widthFactor` (1.6, 1–1.8), `highlight: false` off.
- A MapLibre layer configured in place of the default is drawn as given: Places `layers.selected`, Routing `layers.mainLines.routeOutline` `line-width`, Geometries `layers.line` `line-width`.
- States survive `setVisible`, config changes and `setStyle`; a new `show()`, `clear()` or `setStyle(…, { resetState: true })` drops them — read the selection first and put it back after re-showing.
- Base map, POIs and traffic tile modules have no event states.

### `recently-hovered`

For `hoverGracePeriodMS` (default 400; module `events` override wins) after the pointer leaves a GeoJSON-backed feature, its `eventState` is `'recently-hovered'` unless hovered or clicked again first. SDK layers draw it as no state; Places entry points read it. Your own `['has', 'eventState']` matches it — add `['!=', ['get', 'eventState'], 'recently-hovered']`, or set `hoverGracePeriodMS: 0`.

---

## Gotchas

- `off(type)` removes **all** handlers of that type; use the unsubscribe from `on` to remove one. `off` takes no handler argument.
- `'hover'` fires on entering each new feature, not once per enter/leave cycle. There is no leave event: react to the next `hover`, a base-map `hover`, or `recently-hovered`.
- `'long-hover'` never fires while the map moves; the first one after a move waits `longHoverDelayAfterMapMoveMS`.
- Module-wide `places.events` and `routing.events` type `feature` as `MapGeoJSONFeature`; use `places.events.places` / `routing.events.mainLines` for `Place` / `Route`.
