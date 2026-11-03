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
| `'dragstart'` | A pressed feature moves 3 px (mouse main button or one finger) — see *Dragging* |
| `'drag'` | Every move of the drag, the first right after `dragstart` |
| `'dragend'` | The drag is released |

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
- In drag events, `feature` and `allEventFeatures` are the ones pressed at `dragstart`; `lngLat` is where the pointer is now.
- `allEventFeatures` covers the firing module only. Every feature at the point, all modules and the base map, with `.source` / `.layer` — project first, `queryRenderedFeatures(lngLat)` silently queries the whole viewport:

```ts
const p = map.mapLibreMap.project(lngLat);
const all = map.mapLibreMap.queryRenderedFeatures([[p.x - 5, p.y + 5], [p.x + 5, p.y - 5]]);
```

## Event priority (layer order)

The top-most feature under the pointer picks the one module (and scope) that receives the event; it does not bubble to lower layers. Layer order comes from the style and each module's `beforeLayerConfig`, not from creation order. Only features a handler covers take part: a feature of a module, or scope, with no handler lets the event through to what lies below (a waypoint pin with no `waypoints` handler passes a hover to its route or the base map). Hidden and collision-culled features receive nothing; nothing fires while the map moves.

---

## Custom layer objects — `hitTest`

Register a hit tester for a custom layer, and its objects get the same click, hover and cursor handling as module features. A raw `mapLibreMap.on('click')` picker runs beside the SDK's handlers instead: no hover state or cursor, and the road under the vehicle fires too.

```ts
const vehicles = map.addCustomLayer(vehiclesLayer, {
  beforeLayerConfig: 'lowest3D',
  hitTest: (point) => pickVehicles(point), // [{ id, properties? }], topmost first; point in pixels
  setState: (id, state) => highlightVehicle(id, state), // 'hover' | 'click' | 'recently-hovered' | … | undefined
  events: { cursorOnHover: 'pointer' },
});
vehicles.events.on('click', (vehicle) => inspector.show(vehicle)); // the object hitTest returned
```

- The hits merge with the rendered features **in layer order**, so priority holds: the vehicle wins over a road under it, a module layer drawn above the custom layer wins over the vehicle.
- `setState` is how hover and click states reach your drawing: a custom layer has no feature state. The states follow the module rules (a click outranks a hover, `recently-hovered` for `hoverGracePeriodMS`).
- **The hit tester owns depth**: a screen-projection pick also hits an object behind a 3D building.
- **Hits rank by layer stack, not by draw depth**: with a handler on the 3D buildings, a click on a `'lowest3D'` object in front of a building goes to the building.
- Placement, style-change restore and the three.js side are in `maplibre.md` § Custom layers.

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
        cursorOnMouseDown: 'grabbing',     // default; also while dragging
        cursorOnDraggable: 'grab',         // default; over a feature a drag handler covers, instead of cursorOnHover
        longHoverDelayAfterMapMoveMS: 800, // default; first long-hover after the map moved
        longHoverDelayOnStillMapMS: 300,   // default; next long-hovers on a still map
        hoverGracePeriodMS: 400,           // default; how long a left feature stays 'recently-hovered'
    },
});

// At runtime: merges, omitted keys keep their value; module overrides stay; running timers keep their delay
map.updateEventsConfig({ longHoverDelayOnStillMapMS: 600, hoverGracePeriodMS: 1000 });
```

## Module-level override

A module's `events` (`EventHandlerConfig`) overrides `cursorOnHover`, `cursorOnDraggable` and `hoverGracePeriodMS` for its features:

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

- A predicate decides on the top-most feature the handler covers. A rejected top feature stays inert — map cursor, no `hover`/`click`/`long-hover` state, handler not called — even with a match beneath; no promotion. The handler's `features` are the matching ones, top first.
- `routing.events.mainLines.where((route) => route.properties.routeState === 'deselected')` makes only alternatives selectable, also where one runs under the selected route.
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
routing.events.mainLines.where((route) => route.properties.routeState === 'deselected')
    .on('click', (route) => routing.selectRoute(route.properties.index)); // selectRoute clears the lines' `click`; index is the response index, the shown position only when every route is shown
routing.events.waypoints.on('hover', (waypoint, lngLat) => { });
places.events.places.on('click', (place) => showDetails(place)); // places.events also covers connections + entry points
```

BaseMap, POIs, TrafficFlow, TrafficIncidents, TrafficIncidentDetails, TrafficAreaAnalytics have no named scopes — `events` already is the one scope. `TerrainModule` and `StylingFoundationsModule` have `config-change` only.

---

## Dragging — `dragstart` / `drag` / `dragend`

Any module and scope, on the same `on` / `off` / `where`. A handler for any of the three makes the features it covers draggable: `cursorOnDraggable` (`grab`) on hover, MapLibre doesn't pan the map under the drag (the SDK `preventDefault`s the press; `map.mapLibreMap.dragPan` stays as you set it), touch included (one finger; a second finger ends the drag). The top-most feature decides, as for clicks.

```ts
// Move a stop; the SDK moves nothing itself, so show it again where the pointer is
routing.events.waypoints.on('drag', async (waypoint, lngLat) => {
    waypoints[waypoint.properties.index] = lngLat.toArray();
    await routing.showWaypoints(waypoints);
});
// RoutingModule plans nothing: calculateRoute + showRoutes yourself (throttled during `drag`, or on `dragend`)
routing.events.waypoints.on('dragend', async () => routing.showRoutes(await calculateRoute({ locations: waypoints })));
places.events.places.on('dragend', (place, lngLat) => savePosition(place.id, lngLat)); // Places pins drag too
```

Pulling a new stop onto a route line with `findBestWaypointInsertionIndex`: `routing.md`, *Interactive route editing*. The route-dragging plugin does all of it for a `RoutingModule`: `route-dragging.md`.

- A press released within 3 px stays a `click`; a drag fires **no** `click` on release, so click handlers on the same features don't run.
- Hover is frozen during the drag: no `hover` / `hover-move` / `long-hover` fire, the cursor stays `cursorOnMouseDown`.
- Released outside the map, `dragend` fires with the last position over the map. Disabled events or a second finger end the drag the same way.
- Drag events set no `eventState`; `setEventState` doesn't take them.
- Secondary mouse button never drags; a press while the map is still moving pans instead.

---

## Background clicks and hovers — `BaseMapModule`

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

### Ending a hover — there is no leave event

The pointer leaving a feature either hovers another one or leaves the map. To un-highlight your own UI (a card lit while its route is hovered), end it on the base map's `hover` and MapLibre's `mouseout`:

```ts
// Labels, shields and 3D buildings draw above the routes: any base map handler on them (click too) steals a route's hover.
const underRoutes = baseMap.events.where({ layerGroups: { show: 'only',
    values: ['land', 'water', 'buildings2D', 'roads', 'railways', 'ferries', 'borders'] } });
routing.events.mainLines.on('hover', (route) => highlightCard(route.properties.index));
underRoutes.on('hover', () => highlightCard(undefined));
map.mapLibreMap.on('mouseout', () => { // left the map, e.g. for your panel
    highlightCard(undefined);
    routing.clearEventStates({ states: ['hover'] }); // leaving the map keeps the SDK's hover
});
```

- A module with handlers of its own (places, POIs, waypoints you handle) takes the hover the base map would get: end it on that module's `hover` too.
- Moving on to another feature or the base map turns the left feature's `hover` into `recently-hovered`, drawn as no state. Leaving the map keeps it `hover` (the pointer may be in your popup), so clear it in `mouseout` if it shouldn't stay.
  The SDK still holds that feature as hovered, so coming straight back onto it fires no `hover`: it stays unlit until the pointer moves off it and back.
- Don't add a handler only to detect leaving a module's features: it makes them hoverable, so they take the hover state and its look (waypoint pins grow).

---

## Event states — select, highlight and read back features

A click, contextmenu, hover or long-hover on a feature a handler covers writes `properties.eventState` on it (`recently-hovered` after the pointer leaves). Every data-owned module — PlacesModule, RoutingModule, GeometriesModule, ReachableRangesModule, CustomGeoJSONModule, TrafficIncidentDetailsModule, TrafficAreaAnalyticsModule — has four methods to put, clean and read them (e.g. sync a list with the map):

```ts
routing.setEventState({ id: routeID, state: 'click' });           // mode 'put' (default) moves it off any other route
routing.setEventState({ index: 0, state: 'hover', mode: 'add' }); // 'add' keeps the others' states
routing.setEventState({ index: 1, state: 'hover', show: false }); // show: false defers the redraw, for batches
routing.clearEventState({ id: routeID });
routing.clearEventStates({ states: ['hover'] });                  // or () for every state
const { click: [clickedID] = [], hover = [] } = routing.getEventStates(); // ids by state, user's and yours; absent = none
// a route's `click` is not its selection: selectRoute clears it; read routeState === 'selected'
```

- The module methods act on exactly what `getShown()` returns as main features — Places `places` (clustered or not), Routing `mainLines`, Geometries / ReachableRanges `geometry`, Custom every source, TrafficIncidentDetails `incidents`, TrafficAreaAnalytics `hexgrid` + `square` + `heatmap`. An id from `getShown()` or a handler is an id they take.
- `id` matches `properties.id`, else the top-level `id` (string or number). `index` is the position in that collection; with several sources, each counts its own.
- Named scopes have the same four methods for their own features (`UserEventsWithStates`): `routing.events.waypoints.setEventState(...)`, `places.events.entryPoints`, `custom.events.<source>` — use the scope when ids repeat across sources.
- A user click/contextmenu clears `click` + `contextmenu` from the other features of the source it lands on; a user hover clears `hover` + `hover-move` + `long-hover` — yours included, so a selection put in code moves on the next click. To let clicks add up, re-put the earlier ids with `mode: 'add'` in the click handler.
- Default hovered/clicked look (one for both): place pins larger, label in `color`, plus entry points; routes a wider outline; geometries and range bands a denser fill and wider border in their own colour; details-module incidents a wider stripe over an outline; area-analytics cells outlined. Custom layers draw only what you style by `['get', 'eventState']`.
- Tuning: Routing `highlight.outline.widthFactor` (default 1.2, range 1–1.25), and for the ring `setSectionFocus` draws `highlight.section.outline.color` (unset: black on light, white on dark) and `highlight.section.outline.widthFactor` (1, 0.5–2); Geometries / ReachableRanges `highlight.fill.opacityFactor` (2, 1–4) and `highlight.line.widthFactor` (1.75, 1–3) — catalogue knobs multiplying the opacity and width in force; `1` turns that look off. Details module `highlight.outline.color` and `highlight.line.widthFactor` (1.6, 1–1.8), `highlight: false` off.
- A MapLibre layer configured in place of the default is drawn as given: Places `layers.selected`, Routing `layers.mainLines.routeOutline` `line-width`, Geometries `layers.line` `line-width`.
- States survive `setVisible`, config changes and `setStyle`; a new `show()`, `clear()` or `setStyle(…, { resetState: true })` drops them — read the selection first and put it back after re-showing.
- Base map, POIs and traffic tile features take the state as the feature state `eventState` (not `properties`), only when the tile gives the feature an id, and have no methods to put or read it. Read it with `['feature-state', 'eventState']` in a raw layer edit. The base map's 3D buildings draw it once `buildings3D.hover` / `buildings3D.click` has a colour: `map-setup.md` § BaseMapModule.

### `recently-hovered`

For `hoverGracePeriodMS` (default 400; module `events` override wins) after the pointer leaves a GeoJSON-backed feature, its `eventState` is `'recently-hovered'` unless hovered or clicked again first. SDK layers draw it as no state; Places entry points read it. Your own `['has', 'eventState']` matches it — add `['!=', ['get', 'eventState'], 'recently-hovered']`, or set `hoverGracePeriodMS: 0`.

---

## Gotchas

- `off(type)` removes **all** handlers of that type; use the unsubscribe from `on` to remove one. `off` takes no handler argument.
- A named scope's `off(type)` also strips the module's module-wide handlers from that scope's features: after `places.events.places.off('click')`, a `places.events.on('click', h)` stops firing on pins but still fires on connections and entry points.
- `'hover'` fires on entering each new feature, not once per enter/leave cycle. There is no leave event: see *Ending a hover* above.
- `'long-hover'` never fires while the map moves; the first one after a move waits `longHoverDelayAfterMapMoveMS`.
- Don't drag with raw `mapLibreMap.on('mousedown')` + `queryRenderedFeatures` + `dragPan.disable()`: `drag*` handlers do it, keep the SDK's hit priority, and drop the trailing `click`.
- Module-wide `places.events` and `routing.events` type `feature` as `MapGeoJSONFeature`; use `places.events.places` / `routing.events.mainLines` for `Place` / `Route`. A `pin-clustered` cluster isn't a `Place`, so it reaches `places.events` only (`cluster: true`, `cluster_id`, `point_count`), never `places.events.places`.
