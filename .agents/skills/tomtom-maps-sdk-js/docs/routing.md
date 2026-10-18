# Routing Reference

## Imports

```ts
import { calculateRoute, calculateReachableRanges, geocodeOne } from '@tomtom-org/maps-sdk/services';
import {
    RoutingModule, GeometriesModule, ReachableRangesModule,
    defaultRoutingLayers, SELECTED_ROUTE_FILTER, MIDDLE_INDEX,
} from '@tomtom-org/maps-sdk/map';
import type {
    PlanningWaypoint, GeometryFillStyle, GeometryBeforeLayerConfig, ReachableRangesModuleConfig,
} from '@tomtom-org/maps-sdk/map';
import { bboxFromGeoJSON, formatDistance, formatDuration, withInsertedWaypoint } from '@tomtom-org/maps-sdk/core';
import type { Waypoint, WaypointLike, PolygonFeatures } from '@tomtom-org/maps-sdk/core';
```

---

## Basic route — geocode → calculate → display

```ts
const routingModule = await RoutingModule.create(map);

const [origin, destination] = await Promise.all([
    geocodeOne('Amsterdam, Netherlands'),
    geocodeOne('Rotterdam, Netherlands'),
]);

const routes = await calculateRoute({ locations: [origin, destination] });

// showRoutes draws lines, sections, guidance and summary bubbles, but no pins; showWaypoints draws the pins — always call both
await routingModule.showRoutes(routes);
await routingModule.showWaypoints([origin, destination]);

const summary = routes.features[0].properties.summary;
console.log(formatDistance(summary.lengthInMeters));      // e.g. '75 km'
console.log(formatDuration(summary.travelTimeInSeconds)); // e.g. '1 hr 10 min'
console.log(summary.arrivalTime);                         // Date object
```

---

## Coordinate-only locations (no geocoding needed)

```ts
const routes = await calculateRoute({
    locations: [
        [4.897, 52.377],   // [longitude, latitude]
        [4.897, 52.200],
        [4.462, 51.926],
    ],
});
```

A nested coordinate array is a **path** — geometry the route must follow, for replaying a route you
already have. It is not a stop-free corridor: the path's endpoints go out as waypoints, so a path
between an origin and a destination adds two of them and the legs that come with them.

```ts
// Reconstruct a route from its own coordinates — one path, no extra waypoints
const routes = await calculateRoute({ locations: [previousRoute.geometry.coordinates] });
```

---

## Multiple alternatives — display and select

```ts
const routes = await calculateRoute({
    locations: [origin, destination],
    maxAlternatives: 2,    // returns up to 3 routes (best + 2 alternatives)
});

await routingModule.showRoutes(routes, { selectedIndex: 0 });
await routingModule.showWaypoints([origin, destination]);

// Programmatic selection
await routingModule.selectRoute(1);

// Let user click to select — the handler also makes the hovered or clicked route draw a wider
// outline (its eventState), `highlight.outline.widthFactor` times (default 1.2, clamped 1–1.25 so a
// section halo stays in sight; 1 turns it off); a `layers.mainLines.routeOutline` line-width is
// drawn as given instead
routingModule.events.mainLines.on('click', (feature) => {
    routingModule.selectRoute(feature.properties.index);
});
```

---

## Clearing routes and waypoints

```ts
// Remove route lines from the map (does NOT clear waypoints)
await routingModule.clearRoutes();

// Remove waypoint markers
await routingModule.clearWaypoints();

// Calling showRoutes() again replaces the previous display — no need to clear first
await routingModule.showRoutes(newRoutes);

// Hide everything the module draws, keeping routes and waypoints; `{ visible: false }` at create too
routingModule.setVisible(false);
routingModule.isVisible(); // false — the setting
```

- Hidden stays hidden through `showRoutes`, `showWaypoints`, `selectRoute`, the clears and `setStyle`; `setVisible(true)` draws what is shown.
- While shown, each part's own `visible` (`sections.<type>.visible`, `summaryBubbles.visible`, …) still decides whether it draws.

---

## Multiple routes with different colors

Create separate `RoutingModule` instances for each route — they manage routes, waypoints, and events independently:

```ts
const colors = ['#0066CC', '#00BBDD', '#33AA33', '#99BB00'];

for (let i = 0; i < origins.length; i++) {
    const module = await RoutingModule.create(map, { color: colors[i % colors.length] });
    const routes = await calculateRoute({ locations: [origins[i], destination] });
    await module.showRoutes(routes);
    await module.showWaypoints([origins[i], destination]);
}
```

---

## Traffic and routing options

```ts
const routes = await calculateRoute({
    locations: [origin, destination],
    costModel: {
        traffic:   'live',       // 'live' | 'historical'
        routeType: 'fast',       // 'fast' | 'short' | 'efficient' | 'thrilling'
        avoid: ['tollRoads', 'ferries', 'motorways'],
    },
    guidance: { type: 'coded' },  // enables turn-by-turn instructions
    maxAlternatives: 2,
});

const instructions = routes.features[0].properties.guidance?.instructions;
```

`avoid` takes any of `avoidableTypes`: `tollRoads`, `motorways`, `ferries`, `unpavedRoads`, `carpools`,
`alreadyUsedRoads`, `borderCrossings`, `tunnels`, `carTrains`, `lowEmissionZones`.

---

## Vehicle weight, speed and toll restrictions

```ts
const routes = await calculateRoute({
    locations: [origin, destination],
    vehicle: {
        model: {
            dimensions: { weightKG: 3500 },
        },
        // tollTransponder is 'all' | 'unknown' | 'none' — tolls payable only by transponder are
        // avoided with 'none', tolls that cannot be paid by one are avoided with 'all'
        restrictions: { maxSpeedKMH: 80, tollTransponder: 'none' },
    },
});
```

`vehicle` is weight, heading (`state.heading`, `calculateRoute` only) and these restrictions. There
is no engine, consumption model, charge or fuel state, and no long-distance EV routing with charging
stops: asked for one, say the SDK does not plan it.

**No truck routing on v3.** `travelMode` is `'car'` only, and `weightKG` is the only dimension. Both
endpoints (routing and reachable range) answer:

| Rejected by the API | Answer |
|---|---|
| Length, width, height, axle weight, load type (hazmat), ADR tunnel code | `400 Unknown JSON field` — under any spelling (`vehicleHeight`, `vehicleHeightInMeters`) |
| Commercial vehicle | `400 Invalid boolean value` unless `false` |
| `travelMode: 'truck'` | not a travel mode |

- None of them is on the SDK types; don't reach past the types (a cast, a raw `fetch`) to send one — the request fails with `400`.
- Asked for truck dimensions, hazmat or tunnel avoidance: say v3 does not support them, rather than writing code that sends them.

---

## Arrival side

```ts
// One of `arrivalSides` (importable): 'any' (default) arrives from whichever side is faster; 'curb'
// arrives on the curb side for the country's driving direction, at the destination and every stop
const routes = await calculateRoute({ locations: [origin, destination], arrivalSide: 'curb' });
```

---

## Per-stop options — pause, arriving-leg cost model, entry points

Options ride on a waypoint's own `properties`, typed with `RouteStopOptions`. They describe the leg
*arriving* at that stop plus the wait once there, so inserting an earlier stop leaves them attached
to the right place.

```ts
import type { RouteStopOptions } from '@tomtom-org/maps-sdk/services';
import type { Waypoint } from '@tomtom-org/maps-sdk/core';

const stop: Waypoint<RouteStopOptions> = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.4467, 41.5381] },
    properties: {
        pauseDurationSeconds: 1800,                                   // counted into travel time,
                                                                      // and shown on the stop's pin
        legCostModel: { routeType: 'short', avoid: ['motorways'] },   // this leg only
        candidateEntryPoints: [[2.4467, 41.5381], [2.4479, 41.5372]], // router picks one
        preferredEntryPointIndex: 1,
    },
};

const routes = await calculateRoute({ locations: [origin, warehouse, destination] });
```

The wait comes back on the leg that arrives at the stop, as time spent there:

```ts
const legs = routes.features[0].properties.sections.leg;
legs[0].summary.stopTimeInSeconds;    // whole time at the first stop (absent when it does not stop)
legs[0].summary.travelTimeInSeconds;  // driving only — the stop is NOT in here
routes.features[0].properties.summary.travelTimeInSeconds; // driving + every stop
```

**Gotchas:**
- `pauseDurationSeconds` is a core `WaypointProps` field, not a `RouteStopOptions` one, because the
  map reads it too: `showWaypoints` labels the stop's pin with the formatted wait by default.
- Driving time = sum of the legs' `travelTimeInSeconds`; total time standing still = the route's
  minus that sum.
- `pauseDurationSeconds` is rejected on the destination — the API requires the last leg's pause to
  be 0, so request validation fails before anything is sent. Which stop is the destination is
  positional and `locations` is an array callers build dynamically, so this is a validation rule
  rather than something the type can carry.
- `legCostModel` on the origin is ignored: the origin has no arriving leg.
- Not called `entryPoints`: a `Place` already carries its own `entryPoints` from search, and those
  are never sent to the routing API.

---

## Legs and the requested stops

A path location expands into legs of its own, so legs do not always line up with the requested
stops. `leg.originalWaypointIndex` maps a leg back to the stop the caller asked for:

```ts
routes.features[0].properties.sections.leg?.forEach((leg) => {
    const index = leg.originalWaypointIndex;  // undefined on the final leg
    const stop = index === undefined ? undefined : locations[index];
});
```

---

## Reachable ranges (isochrones)

> [Private preview](https://docs.tomtom.com/legal/private-preview) — `calculateReachableRange(s)` needs an API key with Calculate Reachable Range access, which Freemium and Pay As You Grow (PAYG) keys do not have; the developer requests it from TomTom Sales. A key without it rejects with `INSUFFICIENT_PERMISSIONS` carrying `.privatePreviewAccess: { product, requestAccessURL }` (`services-config.md` § Error handling) — relay that to the developer instead of "check the API key". The API's own documentation on developer.tomtom.com requires an enterprise login, so rely on the SDK types and this doc rather than linking there.

Guides: [calculating ranges](https://docs.tomtom.com/maps-sdk-js/guides/services/routing/reachable-ranges.md),
[reachable ranges module](https://docs.tomtom.com/maps-sdk-js/guides/map/reachable-ranges.md).

```ts
const rangesModule = await ReachableRangesModule.create(map, { fill: { style: 'filled' } });

const ranges = await calculateReachableRanges([
    { origin: [4.9, 52.4], budget: { type: 'timeMinutes', value: 10 } },
    { origin: [4.9, 52.4], budget: { type: 'timeMinutes', value: 20 } },
    { origin: [4.9, 52.4], budget: { type: 'timeMinutes', value: 30 } },
]);

await rangesModule.show(ranges);  // auto-titles: '30 min', '20 min', '10 min'
```

**A range the service answers with an error is skipped, not thrown**, unless it's a 401, 403 or 429; a network failure, an aborted signal and an invalid request reject the batch too. An origin off the drivable road network (a pedestrian square, water) answers `NO_RANGE_FOUND`, so `ranges.features` can be shorter than the request array, or empty: match each feature to its request through `properties.budget` / `properties.origin`, and treat an empty result as "no range from here". `calculateReachableRange` (singular) rejects with that error instead.

`ReachableRangesModule` (data-owned, `create()`, its own sources and layers — not `GeometriesModule`) draws `calculateReachableRanges` output unchanged:

- Ranges are grouped by `properties.origin`, so one `show` holds several origins' bands, each nested around its own; one request may mix origins. Each border is labelled from its `budget`; `lineLabel.title: (feature, index) => string` replaces it.
- **Colours**: without `fill.palette`, a ramp from the map's accent (innermost band) toward its land colour (outermost), both from `map.mapColors`, reversed for `'inverted'`, so out of reach deepens outward. Without map colours it ramps between the style's light/dark defaults (`#0A3653` → white on light, `#5FA8D8` → `#333333` on dark) and follows a style switch. It repaints on its own when either changes — e.g. `styling.setMapColors(deriveMapColors([...]))` with the map-theme plugin (`map-theming.md`). `fill: { palette: string[] }` sets your own CSS colours, innermost first, cycling; `[]` hands colours back to the map. Bands of the same rank share a colour across origins.
- Config: `visible`, `fill.style` (default `'filled'`), `fill.palette`, `lineLabel` (`LabelConfig` for the border labels, plus `title`), `highlight` (`fill.opacityFactor`, `line.widthFactor`), `beforeLayerConfig` (default `'lowestLabel'`), `layers` (`GeometryLayersConfig`, as `GeometriesModule`'s below). `ReachableRangesModuleSerializableConfig` omits `lineLabel.title`.
- `'inverted'` shades what is out of reach: the world beyond the union of each origin's largest range, then a ring outside each smaller one.
- Events: `events.geometry` covers the bands, their borders and the labels along them (drawn from the same features); `events.geometryLabel` only the title points `getShown().geometryLabel` lists.

Budget types (`BudgetType`, listed in `budgetTypes`; `ReachableRangeBudget` is `{ type, value }`, all from `@tomtom-org/maps-sdk/core`): `'timeMinutes'`, `'distanceKM'`. `budgetUnits` (core) maps each to the unit the auto-titles print — `` `${budget.value} ${budgetUnits[budget.type]}` `` gives `'30 min'`, `'50 km'`.

Each polygon's `properties` is a `ReachableRangeProperties`: the request it was calculated with (`origin`, `budget`, `vehicle`, …), minus `apiKey`, base URLs, callbacks, `signal` and every other `CommonServiceParams` field.

Fill styles (`GeometryFillStyle`, the `fill.style` option): `'filled'` | `'outline'` | `'inverted'`

Before-layer config: `'top'` or a key of `mapStyleLayerIDs` (`'lowestLabel'` | `'lowestPlaceLabel'` | `'lowestRoadLine'` | ...), or `{ all?, fill?, line? }` to place the fill and the border apart

### Parameters this endpoint does not take

The SDK never sends a parameter the endpoint would reject: these throw at the call, with a message
naming the parameter and what to do instead, and `ReachableRangeParams` already leaves out
`costModel.avoidAreas` and `when.arriveBy`. Do not carry a `calculateRoute` parameter object over
as-is:

```
vehicle.state.heading: calculateReachableRange has no vehicle heading parameter. Remove it, or use calculateRoute, which accepts it.
```

| Not accepted | Use instead |
|---|---|
| `vehicle.state.heading` | Omit it, or use `calculateRoute` |
| `costModel.avoid: 'alreadyUsedRoads'` | Drop that entry; the other avoidables work |
| `costModel.avoidAreas` | Omit it |
| `when.arriveBy` | `when.departAt`, or omit `when` |

The rest of `vehicle`, `costModel` and `when` works as it does in `calculateRoute`.

### Abort in-flight requests

`calculateRoute` takes a `signal` like every service (`services-config.md` covers aborts, deadlines
and `SDKAbortError`). When a newer plan supersedes the previous one, run it through
`createLatestRequest` instead of catching the abort by hand:

```ts
import { calculateRoute, createLatestRequest } from '@tomtom-org/maps-sdk/services';

const latestRoute = createLatestRequest();

const calculate = async () => {
    const routes = await latestRoute.run((signal) => calculateRoute({ locations, signal }));
    if (routes.current) await routingModule.showRoutes(routes.value);
};
```

`calculateReachableRanges` also accepts a batch-level signal as its second argument, which
applies to every range in the array:

```ts
const ranges = await calculateReachableRanges(paramsArray, { signal });
```

### Update range config without re-fetching

A config change restyles the ranges already shown — colours, fill style, labels, titles — so there
is no need to call `show()` again. `applyConfig` replaces the whole config (what it leaves out goes
back to the default), `updateConfig` changes one part, `resetConfig` returns to the defaults.

```ts
rangesModule.applyConfig({ fill: { style: 'inverted', palette: ['#b3001b', '#e85d04', '#faa307'] } });
// or move the ranges before a different layer
rangesModule.updateConfig({ beforeLayerConfig: 'lowestRoadLine' });
```

### Every knob as data — `reachableRangesKnobCatalogue`

`reachableRangesKnobCatalogue` lists the module's plain-valued settings as `KnobEntry`s; set one by id
with `setKnob(rangesModule, reachableRangesKnobCatalogue, id, value)`. `reachableRangesKnobIds` lists
the ids, `ReachableRangesKnobId` / `ReachableRangesKnobValueOf<ID>` type them.

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `true` |
| `fill.style` | enum (`filled`, `outline`, `inverted`) | `'filled'` |
| `fill.palette` | colors | — (the accent-to-land ramp) |
| `highlight.fill.opacityFactor`, `highlight.line.widthFactor` | factor, 1–4 and 1–3 | `2`, `1.75` |
| `lineLabel.size`, `lineLabel.haloWidth`, `lineLabel.opacity` | number | `15`, `2`, `1` |
| `lineLabel.color`, `lineLabel.haloColor` | color | — (theme-adaptive) |
| `lineLabel.font` | enums (`mapFonts`) | — (`Noto-Bold` in the labels' typeface) |
| `lineLabel.typeface` | enum (`mapTypefaces`) | — (the map's typeface) |

---

## Traffic incidents on route

`showRoutes()` automatically renders incident markers along the route:

```ts
const routes = await calculateRoute({
    locations: [origin, destination],
    costModel: { traffic: 'live' },
});

await routingModule.showRoutes(routes);

const { trafficDelayInSeconds } = routes.features[0].properties.summary;

routingModule.events.incidents.on('click', (feature) => {
    const { categories, magnitudeOfDelay, delayInSeconds } = feature.properties;
});
```

---

## Accessing route data

```ts
const route = routes.features[0];

const { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds,
        arrivalTime, departureTime } = route.properties.summary;

const sections     = route.properties.sections;
const instructions = route.properties.guidance?.instructions;
const path         = route.geometry.coordinates; // [lng, lat][]
```

---

## Turn-by-turn instructions

Guide: [guidance](https://docs.tomtom.com/maps-sdk-js/guides/services/routing/guidance.md).

`guidance: { type: 'coded' }` is what fills `route.properties.guidance.instructions`. Every
instruction carries ready-made text, so a turn list needs no translation table of your own:

```ts
const routes = await calculateRoute({
    locations: [origin, destination],
    guidance: { type: 'coded' },
});

routes.features[0].properties.guidance?.instructions.forEach((inst) => {
    inst.message;         // 'Turn right onto Damrak' — generated and localised by the service
    inst.maneuver;        // Maneuver code, e.g. 'TURN_RIGHT'
    inst.maneuverPoint;   // Position — [lng, lat]
    inst.roundaboutType;  // 'REGULAR' | 'SMALL' — on roundabout maneuvers
    inst.maneuverView;    // the junction layout: { onRouteAngle?, offRouteAngles }
    inst.sideRoads;       // [{ side: 'LEFT', offsetFromManeuverInMeters: 12, isDrivable: true }]
    inst.nextRoadInfo.streetName?.text;  // 'Damrak'
    inst.nextRoadInfo.countryCode;       // ISO3
});
```

- `message` is present on every instruction — read it instead of mapping `maneuver` to your own
  strings.
- `maneuverView` angles are relative **directions**, not degrees: `ManeuverAngle` is `'STRAIGHT' |
  'SLIGHT_RIGHT' | 'RIGHT' | 'SHARP_RIGHT' | 'SLIGHT_LEFT' | 'LEFT' | 'SHARP_LEFT' | 'BACK'`.
  `onRouteAngle` is the way the route goes, `offRouteAngles` the ways it passes up — enough to draw
  a junction diagram.
- `isDrivable` on a side road says whether it can actually be driven into. A non-drivable one still
  belongs in a diagram; it just cannot be taken by mistake.

---

## Route sections — what costs money, and which incident

```ts
const sections = routes.features[0].properties.sections;

sections.toll;      // stretches charging a per-use toll (ticket, barrier or free-flow point)
sections.tollRoad;  // stretches that cost money by ANY scheme — a superset of `toll`
sections.traffic?.forEach((t) => t.eventId);  // join key to the traffic incident details service
```

- **`toll` vs `tollRoad`.** `toll` answers *will this cost a toll to drive*; `tollRoad` answers
  *does this cost anything at all to drive* — a vignette-only motorway (Austria, Switzerland) or an
  urban charge zone (central London, Milan Area C, Stockholm) appears in `tollRoad` and not in
  `toll`. `RoutingModule`'s `tollRoads` overlay draws `tollRoad`.
- Leaving `sectionTypes` unset requests every section type, `tollRoad` included. Passing a list
  requests only the types it names, so a list has to name `'tollRoad'` to keep it.
- `lanes` comes only with `guidance`; with a `sectionTypes` list, only if the list names it.
- The section types: `carpool`, `carTrain`, `country`, `ferry`, `importantRoadStretch`,
  `lowEmissionZone`, `motorway`, `pedestrian`, `roadShields`, `speedLimit`, `toll`, `tollRoad`,
  `tollVignette`, `traffic`, `tunnel`, `unpaved`, `urban`, `vehicleRestricted`, `lanes`, `leg`.

---

## RoutingModule — visual customization

Guides: [routes](https://docs.tomtom.com/maps-sdk-js/guides/map/routes.md),
[route styling](https://docs.tomtom.com/maps-sdk-js/guides/map/routes-styling.md),
[route sections](https://docs.tomtom.com/maps-sdk-js/guides/map/routes-sections.md).

### Custom route color, width and waypoint size

```ts
const routingModule = await RoutingModule.create(map, {
    color: '#DF1B12',        // route line, outline (darker shade), waypoint pins
    widthPreset: 'l',        // 's' | 'm' | 'l'
    widthFactor: 1.2,        // × the widthPreset; clamped to its catalogue range (0.5–2)
    waypoints: {
        sizePreset: 's',     // 's' | 'm' | 'l'
        sizeFactor: 1.5,     // × the waypoints.sizePreset; clamped to its catalogue range (0.5–2)
    },
    highlight: { outline: { widthFactor: 1.25 } }, // × the outline of a hovered or clicked route; clamped to its catalogue range (1–1.25)
});
```

- Without `color`, the route follows the map's accent (`colors.accent`) when a theme sets one — see `map-theming.md`.
- `getConfig()` returns exactly what was passed: no `displayUnits` filled in from `TomTomConfig`, no built `layers`, and `undefined` when nothing was. Without `displayUnits` the labels use the global units in force when drawn — a later `TomTomConfig.instance.put({ displayUnits })` reaches shown routes on the next `showRoutes` or config change. Read `TomTomConfig.instance.get().displayUnits` for the units in force.
- A factor composes with its preset: `{ widthPreset: 'l', widthFactor: 1.5 }` is 1.5 × the `'l'` profile. The waypoint presets are 0.75 / 1 / 1.25 × `'m'`.
- The instruction arrows follow only `widthFactor`; no `widthPreset` resizes them. The stop marks scale with their pins, preset and factor alike, and stay centred in the pin head at every zoom.
- Waypoint labels follow the map's light/dark theme like place and geometry labels: `#333333` text on a `#FFFFFF` halo on a light map, the two swapped on a dark one. `waypoints.label` (a `LabelConfig`: `color`, `haloColor`, `haloWidth`, `size`, …) overrides them; `layers.waypoints.routeWaypointLabel.paint` still wins over it.

### Waypoints: who draws them, pins per role, stop marks, labels, icons of your own

Every location the route is calculated through goes to `showWaypoints`, not to a `PlacesModule`:
the pin then carries its role, its stop mark and the `waypoints` events. Places own what the user is
still choosing among (search results, candidate stops); when one joins the route, `clear()` it there
and pass it to `showWaypoints`. Only a location several routing modules share (one destination for
routes from several origins) is better marked once by a `PlacesModule`.

```ts
import { buildWaypointTitle } from '@tomtom-org/maps-sdk/map';

const routingModule = await RoutingModule.create(map, {
    waypoints: {
        icon: {
            style: { outlineColor: '#FFFFFF' },                    // every pin
            start: { style: { fillColor: '#1B7A3E' } },            // one role, over `style`
            finish: { image: { image: chequeredFlagSVG } },        // a role's pin replaced by an image
            // a pin per waypoint from its data; `undefined` keeps the role's pin and stop mark
            mapping: { to: 'poiCategory', fn: (waypoint) => waypoint.properties.poi?.categories?.[0] },
        },
        stopNumbering: 'letters',                                  // 'numbers' (default) | 'letters' | 'none'
        label: {
            visible: true,
            title: (waypoint) => (waypoint.properties.indexType === 'finish' ? 'Home' : buildWaypointTitle(waypoint) ?? ''),
        },
        highlight: { sizeFactor: 1.3 },                            // hovered/clicked pin, 1–1.5, default 1.2
    },
});
```

- A pin without a `fillColor` takes the route's `color` (the map's accent when unset).
- `mapping` is the Places `IconMapping` (`to: 'imageID'` names a sprite image or a
  `waypoints.icon.customIcons` entry; `to: 'poiCategory'` draws the SDK's category pin). `fn` and a
  function `title` receive a `DisplayWaypoint`, whose `properties.poi` is typed.
- The stop count includes stops a mapping replaces, so marks keep matching the stop order. The mark
  is `properties.stopDisplayLabel` on what `events.waypoints` handlers receive.
- Images draw at pixel ratio 2 unless they set `pixelRatio`, standing on the point by their bottom
  middle; the SDK's pins are 120 × 140 px.
- `applyConfig` reaches the waypoints already shown; they keep their ids and event states.
- `RoutingModuleSerializableConfig` keeps the images and styles, and drops `mapping` and a function
  `title`.
- Live: the `route-waypoints-playground` example.

### Route sections — style a section type without writing MapLibre

All fifteen drawn section types are configured under `sections`, keyed by type, on the same knobs:
`carpool`, `carTrain`, `ferry`, `importantRoadStretch`, `lowEmissionZone`, `motorway`,
`pedestrian`, `speedLimit`, `tollRoad`, `tollVignette`, `traffic`, `tunnel`, `unpaved`, `urban`,
`vehicleRestricted`.

Whether a type is drawn by default is per type, on one rule: a type draws itself when its stretches
are sparse along a route and consequential for the driver. That is `carTrain`, `ferry`,
`lowEmissionZone`, `tollRoad`, `tollVignette`, `traffic`, `tunnel` and `vehicleRestricted` — switch
them off with `{ visible: false }`. `speedLimit` draws itself too, despite running nearly the whole
route, because it posts a sign per section rather than banding it (see below). The other six are
**opt-in**, so `visible: true` is what puts one on the map; `motorway` and `urban` each run nearly
the whole route, so a band drawn for them buries the route line.

```ts
const routingModule = await RoutingModule.create(map, {
    sections: {
        urban: { visible: true },                                            // draw an opt-in type
        lowEmissionZone: { color: '#1B7A43', opacity: 0.8 },                 // restyle a drawn one
        motorway: { visible: true, widthPreset: 'l' },                       // 's' | 'm' | 'l'
        tunnel: { color: '#402060', style: 'halo' },                          // restyle a drawn one
        tollRoad: { icon: { image: 'poi-toll_plaza', placement: 'along' } },  // icon from the sprite
        traffic: { visible: false },                                         // drop one
    },
});
```

The knobs: `visible`, `color`, `opacity`, `widthPreset` (`'s' | 'm' | 'l'`), `widthFactor` (× `widthPreset`,
0.5–2, defaults to the route's own `widthFactor`), `style` (`'halo' | 'inline'`), `pattern`
(`'solid' | 'dashed' | 'dotted'`), `icon` (`{ image, placement: 'center' | 'along', sizeFactor }`,
`sizeFactor` × the type's own icon size, zoom ramp kept, clamped to
its catalogue range, 0.25–2) and `sign`, which only `speedLimit` takes (see below). `ferry`, `tollRoad`, `tunnel` and `vehicleRestricted`
draw an icon where each section starts, which `icon` replaces — for the last two it is a road sign
(see below).

`style` sets the layer order and the width together, which is what makes the two looks distinct:

- `style: 'halo'` draws the section under the route's own lines and wider than its outline, so it
  bands the route while the route keeps its colour. Default for the nine generated types that band
  the route and for `tollRoad`, which is why a low-emission zone reads as a green outline around it.
- `style: 'inline'` draws it over the route line at the route's own width, so the route itself
  appears in the section's colour there. Default for `ferry`, `traffic`, `tunnel` and
  `vehicleRestricted` — this is why a route goes grey through a tunnel.

Changing `style` through `applyConfig` restacks the layers, so a section can move from one side of
the route line to the other at runtime.

Not every type answers to every knob, and the config type says so: `traffic` colours its line by
`magnitudeOfDelay` and takes its icons from the incident data, so `sections.traffic.color` is a
compile error, not a setting that draws nothing. The delay colours follow the incident colour
styling knobs live (`map-styling.md` § Borrowed looks). `speedLimit` draws no line at all, so it takes
only `visible` and `sign`. `sectionSupportsKnob(type, knob)` reports the same
at runtime, for a panel that builds its controls from the type, and narrows `type` to
`SectionTypeWithKnob<knob>`, so `` knobEntryOf(routingKnobCatalogue, `sections.${type}.sign.minZoom`) `` compiles. `sectionDrawsByDefault(type)` says
whether a type starts on, which the map cannot be asked: a route with no ferry sections draws no
ferry layer, so an absent layer reads the same as a type switched off.

### Focusing sections — `setSectionFocus`

To point at sections from your own UI (the leg a stop row describes, the delay a directions row
names), ring them by id. Any section of a shown route counts, of any type, drawn or not; an id no
shown section carries is skipped. The ring runs clear of the widest line the route draws (its hovered
outline or a section's halo), so the route and the sections drawn on it stay in sight — don't fake it
with a wider section halo.

```ts
const [firstLeg] = route.properties.sections.leg;
await routingModule.setSectionFocus([firstLeg.id]);
await routingModule.setSectionFocus(null); // clears; showRoutes() clears it too

routingModule.applyConfig({
    highlight: { section: { outline: { color: '#E63312', widthFactor: 1.5 } } }, // default colour: #000 light, #FFF dark
});
```

- `highlight.section.outline.color` defaults to the theme: black on a light style, white on a dark
  one, as `TrafficIncidentDetailsModule`'s `highlight.outline.color`.
- `highlight.section.outline.widthFactor` × 2 to 4 px as the zoom grows, default 1, clamped 0.5–2.
- `getShown().sectionFocus` holds the focused sections; `layers.sectionFocus.routeSectionFocusOutline`
  overrides the selected route's ring, drawn over every route and section line under the direction
  arrows, and `routeDeselectedSectionFocusOutline` a deselected route's, drawn under the selected route.
- A leg of a route calculated without its polyline has no extent, so focusing it draws nothing.

### Every knob as data — `routingKnobCatalogue`

Every plain-valued `RoutingModuleConfig` display setting, static and readable with no map: kind
(`toggle` / `factor` / `number` / `color` / `enum` / `image` / `text`), `range` or `options`, and
`default` where one value holds everywhere. The id is the setting's path in the config; `routingKnobIds`
lists them in catalogue order.

```ts
import { routingKnobCatalogue, type RoutingKnobValueOf } from '@tomtom-org/maps-sdk/map';

const urbanKnobs = routingKnobCatalogue.filter(({ id }) => id.startsWith('sections.urban.'));
const knob = routingKnobCatalogue.find(({ id }) => id === 'sections.speedLimit.sign.unit');
// { id: 'sections.speedLimit.sign.unit', kind: 'enum', description: '…', options: ['km/h', 'mph'] }
const unit: RoutingKnobValueOf<'sections.speedLimit.sign.unit'> = 'mph';
```

Route-wide knobs first, then each drawn section type's (`<type>` is any of `drawnSectionTypes`).

| Id | Kind | Default |
|---|---|---|
| `visible` | toggle | `true` |
| `color` | color | the map's accent if a theme sets one, else the SDK's blue |
| `widthPreset` | enum, `'s'` / `'m'` / `'l'` | `'m'` |
| `widthFactor` | factor, 0.5–2 | `1` |
| `waypoints.sizePreset` | enum, `'s'` / `'m'` / `'l'` | `'m'` |
| `waypoints.sizeFactor` | factor, 0.5–2 | `1` |
| `highlight.outline.widthFactor` | factor, 1–1.25 | `1.2` |
| `highlight.section.outline.color` | color | — (`#000` light, `#FFF` dark) |
| `highlight.section.outline.widthFactor` | factor, 0.5–2 | `1` |
| `waypoints.icon.style.fillColor` | color | the route's |
| `waypoints.icon.style.outlineColor` | color | — |
| `waypoints.icon.style.outlineOpacity` | number, 0–1 | — |
| `waypoints.icon.start.style.fillColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.start.style.outlineColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.start.style.outlineOpacity` | number, 0–1 | `waypoints.icon.style`'s |
| `waypoints.icon.middle.style.fillColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.middle.style.outlineColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.middle.style.outlineOpacity` | number, 0–1 | `waypoints.icon.style`'s |
| `waypoints.icon.finish.style.fillColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.finish.style.outlineColor` | color | `waypoints.icon.style`'s |
| `waypoints.icon.finish.style.outlineOpacity` | number, 0–1 | `waypoints.icon.style`'s |
| `waypoints.stopNumbering` | enum, `'numbers'` / `'letters'` / `'none'` | `'numbers'` |
| `waypoints.highlight.sizeFactor` | factor, 1–1.5 | `1.2` |
| `waypoints.label.visible` | toggle | `true` |
| `waypoints.label.color` | color | `#333333` (`#FFFFFF` dark) |
| `waypoints.label.haloColor` | color | `#FFFFFF` (`#333333` dark) |
| `waypoints.label.size` | number, 6–48 px | 14 to 16 as the zoom grows |
| `waypoints.label.haloWidth` | number, 0–10 px | `1.5` |
| `waypoints.label.opacity` | number, 0–1 | `1` |
| `waypoints.label.font` | enums, `mapFonts` | — (`Noto-Bold` in the labels' typeface) |
| `waypoints.label.typeface` | enum, `mapTypefaces` | — (the map's typeface) |
| `waypoints.entryPoints` | enum, `'main-when-available'` / `'ignore'` | `'ignore'` |
| `displayUnits.distance.type` | enum, `'metric'` / `'imperial_us'` / `'imperial_uk'` | the global config |
| `displayUnits.distance.kilometers` | text | the global config, else `km` |
| `displayUnits.distance.meters` | text | the global config, else `m` |
| `displayUnits.distance.miles` | text | the global config, else `mi` |
| `displayUnits.distance.feet` | text | the global config, else `ft` |
| `displayUnits.distance.yards` | text | the global config, else `yd` |
| `displayUnits.time.hours` | text | the global config, else `hr` |
| `displayUnits.time.minutes` | text | the global config, else `min` |
| `summaryBubbles.visible` | toggle | `true` |
| `countryCrossings.visible` | toggle | `true` |
| `countryCrossings.minZoom` | number, 0–22 | `4` |
| `countryCrossings.color` | color | follows the map's light/dark theme |
| `countryCrossings.label.color` | color | near-black or near-white, whichever reads |
| `countryCrossings.alignment` | enum, `'viewport'` / `'route'` | `'viewport'` |
| `sections.<type>.visible` | toggle | per type, `sectionDrawsByDefault(type)` |
| `sections.<type>.color` | color | per type |
| `sections.<type>.opacity` | number, 0–1 | — |
| `sections.<type>.widthPreset` | enum, `'s'` / `'m'` / `'l'` | the route's |
| `sections.<type>.widthFactor` | factor, 0.5–2 | the route's |
| `sections.<type>.style` | enum, `'halo'` / `'inline'` | per type |
| `sections.<type>.pattern` | enum, `'solid'` / `'dashed'` / `'dotted'` | per type |
| `sections.<type>.icon.image` | image | — |
| `sections.<type>.icon.placement` | enum, `'center'` / `'along'` | `'center'` on the generated types |
| `sections.<type>.icon.sizeFactor` | factor, 0.25–2 | `1` |
| `sections.speedLimit.sign.placement` | enum, `'atChange'` / `'along'` | `'atChange'` |
| `sections.speedLimit.sign.minZoom` | number, 0–22 | `11` |
| `sections.speedLimit.sign.priority` | enum, `'belowMapLabels'` / `'belowRouteIcons'` / `'aboveRouteIcons'` | follows the placement |
| `sections.speedLimit.sign.unit` | enum, `'km/h'` / `'mph'` | each sign's country, else the display units |

- Section ids follow `sectionSupportsKnob`: `speedLimit` takes only `visible` and `sign`, and
  `traffic` has no `color`, `pattern` or `icon` entry.
- The unit labels are `text` entries with no default. A `displayUnits` knob left unset follows the
  global config's `displayUnits`, field by field.
- Not in it: `layers`, `beforeLayerConfig`, and the waypoint
  images, `mapping` and `title`, which take structured, MapLibre or function values; and `events`.
- Entry shape and kinds: `map-setup.md` § Every setting as data.

### Tunnel and closed-to-vehicles signs where a section starts

`tunnel` and `vehicleRestricted` post a road sign where each of their sections starts, in the
direction of travel, on the selected route. `vehicleRestricted` is a stretch the requested vehicle
is not permitted to use (the Routing API's `travelMode: 'other'` sections), which the route takes.

Both draw by default, so asking for the sections is the whole requirement; the layer overrides
below are optional. Why each sign stacks where it does: the
[route sections guide](https://docs.tomtom.com/maps-sdk-js/guides/map/routes-sections.md#tunnels-and-closed-roads-post-a-sign-where-they-start).

```ts
const routingModule = await RoutingModule.create(map, {
    layers: {
        sections: {
            tunnel: { routeTunnelSymbol: { minzoom: 13 } },
            vehicleRestricted: { routeVehicleRestrictedSymbol: { minzoom: 8 } },
        },
    },
});

const routes = await calculateRoute({ locations, sectionTypes: ['tunnel', 'vehicleRestricted'] });
await routingModule.showRoutes(routes);

routingModule.events.tunnels.on('click', (section) => console.log(section.properties.startPointIndex));
```

- **The tunnel sign** is a white portal on a blue tile, on layer `routeTunnelSymbol`, above the
  map's labels and just under the ferry icons; it gives way to every route icon but the ones
  generated section types ask for, which sit under it.
- **The "closed to vehicles" sign** is an empty red ring (Vienna C2, not the one-way "no entry"
  bar), on layer `routeVehicleRestrictedSymbol`, just under the traffic icons; it wins the space
  over the ferry and tunnel icons, the labels and, at their default `sign.priority`, the speed
  limit signs.
- **From zoom 10, overlap disallowed**, scaling with the zoom as the speed limit signs do, a little
  larger than them (0.5 at zoom 10 to 0.7 at 16). There is
  no `sign` knob for these two types — the layer's own MapLibre `minzoom` and the rest are a
  `layers.sections` override.
- **Every section start icon gives way to the waypoint icon on its point**: 10 px of `icon-padding`
  on the sides facing the waypoint icon's `icon-anchor` (2 elsewhere).
  - The default pin (`bottom`) pads the top; a `routeWaypointSymbol` override anchored at `center`,
    or by an expression, pads every side. A section layer's own `icon-padding` wins.
- **The section knobs reach the sign**: `visible: false` drops it with the line, and `icon`
  (`{ image, placement, sizeFactor }`) replaces it with a sprite image. There is no sign-only
  switch: the module sets every section layer's visibility each time it shows a route, so a
  `layout: { visibility: 'none' }` override does not hold.
- **Events and shown data** stay on the source names, `events.tunnels` / `events.vehicleRestricted`
  and `getShown().tunnels` / `getShown().vehicleRestricted`; the sign has no scope of its own.
- **The sign vocabulary is European and fixed**: it does not localise per country as the speed
  limit signs do, and the tunnel sign's blue does not follow a map theme's accent.

### Speed limits are posted as signs, not banded

`speedLimit` is the one type whose information is a number rather than a stretch, so the module
posts a **road sign where the limit changes** and draws no line at all. Nothing has to be
configured for it:

```ts
// Ask for `country` as well and every sign takes the face and unit of the country it stands in.
const routes = await calculateRoute({ locations, sectionTypes: ['speedLimit', 'country'] });
await routingModule.showRoutes(routes);
```

The sign follows the road, not the reader — face, unit and numeral colour all come from the country
the stretch runs through:

| Country | Face | Unit | Numerals |
|---|---|---|---|
| most of Europe, and anywhere without an entry | white disc | km/h | near-black |
| `SWE`, `FIN`, `ISL` | yellow disc | km/h | near-black |
| `GBR`, `LBR`, `MMR` | white disc | mph | near-black |
| `USA` | `SPEED LIMIT` plaque | mph | near-black |
| `JPN` | white disc | km/h | blue |

Where mph is posted the number is converted and rounded to the step signs come in, so a London
stretch reads `30` and a Californian one `65`, both from the same `maxSpeedLimitInKmh`. With no
`country` sections the display units decide the face and unit; `sign.unit` overrides both.

Signs scale with the zoom (0.45 at zoom 10 to 0.63 at 16), as the ferry and toll-road icons do. That
is not configurable — `sign.minZoom` is the knob for how early they appear at all.

```ts
const routingModule = await RoutingModule.create(map, {
    sections: {
        speedLimit: {
            sign: { placement: 'along', minZoom: 9, priority: 'aboveRouteIcons', unit: 'mph' },
        },
    },
});
```

- **`visible` switches the signs**, because they are the whole of what the type draws — there is no
  second switch, and none of the line knobs (`color`, `widthPreset`, `widthFactor`, `style`, `pattern`,
  `icon`) apply.
- **`sign.placement` defaults to `'atChange'`**: one sign where the limit changes, and none after
  it. That is exact — the sections tile the route end to end and no two consecutive ones share a
  limit, so every boundary is a change. `'along'` repeats the sign down the stretch instead.
  - A stretch can run 50 km, so use `'along'`, or your own readout, when the limit in force has to
    be on screen at any zoom.
- **`sign.minZoom` defaults to 11**, one zoom past the tunnel and closed-road signs (10): a route
  posts many more speed limits, and further out they crowd the route overview.
- **`sign.priority` decides which symbol survives a collision**, since MapLibre resolves them from
  the topmost layer down and the lower layer gives way. `belowMapLabels` yields to the base map's
  labels as well as the route's icons; `belowRouteIcons` yields to every route icon, section icons
  included, and nothing else;
  `aboveRouteIcons` yields to nothing.
  - **The default follows the placement**: `belowRouteIcons` under `'atChange'`, where that sign is
    the only one posting its change; `belowMapLabels` under `'along'`, where the next repeat posts
    the same limit again.
- **Both placements read the section's own line**, so `getShown().speedLimitSections` and
  `events.speedLimitSections` are the surface either way.
- **A route carries more sections than fit**, since it splits wherever its geometry does. The signs
  that fit are drawn; the rest are dropped by collision rather than thinned by configuration.
- The sign layer is `routeSectionSpeedLimitSign`, and every derived fact is on the feature for a
  `layers.sections.speedLimit` override to read: `signImageID` (the face), `signLabel` (the number
  in the unit it is posted in), `signFace` (`'whiteDisc' | 'yellowDisc' | 'plaque'`, which is what
  offsets the number clear of the plaque's own words) and `signNumeralsColor`.

### Border crossings

`country` sections partition a route end to end, each ending where the next begins, so every seam
between two of them is a border. A crossing is that seam — a point rather than a stretch — and sits
under `countryCrossings` rather than in the section catalogue. Each is a plaque naming both
countries in the direction of travel by their ISO 3166-1 alpha-2 codes, `ES → FR`.

```ts
const routingModule = await RoutingModule.create(map, {
    countryCrossings: { minZoom: 6, color: '#0B5FA5', alignment: 'route' },
});

const routes = await calculateRoute({ locations, sectionTypes: ['country'] });
await routingModule.showRoutes(routes);   // the crossings draw themselves
```

- **Asking for `country` sections is the whole requirement.** A route that carries none draws no
  crossings, and the module fetches nothing of its own.
- **Colours follow the map's light/dark theme**: `#1A2024` plaque on a light map, `#F1F3F5` on a
  dark one, and the label takes whichever of the two reads on the plaque. `color` and `label.color`
  override either; setting `color` alone still gets a legible label.
- **`alignment`** is `'viewport'` (level with the screen) or `'route'` (turned to the route's
  bearing where it crosses, kept upright). **`visible`** defaults to `true`, **`minZoom`** to **4**.
- **Re-entering a country is a second crossing**, back the way it came — `CH → FR` then `FR → CH`.
- **Scope and shown data**: `events.countryCrossings` and `getShown().countryCrossings`. Each
  feature carries `fromCountryCode`, `toCountryCode`, the composed `label` and the `bearing`; a
  **clicked** one also carries `fromSection` and `toSection`, the two `CountrySectionProps` it joins.
- The layer is `routeCountryCrossing`, overridable under `layers.countryCrossings`. It is anchored
  under the waypoint pins and the summary bubbles, so a plaque never covers a stop; a `beforeID` on
  that override restacks it.

Each section also gets an event scope and a `getShown()` entry. The ten generated types are keyed
`<type>Sections`; the other five keep their source names (`ferries`, `tollRoads`, `incidents`,
`tunnels`, `vehicleRestricted`):

```ts
routingModule.events.lowEmissionZoneSections.on('click', (section, lngLat) => { /* LEZ */ });
routingModule.getShown().urbanSections;
```

For full MapLibre control, use `layers.sections` with the same type keys. For the generated types
the layer id is derived from the section type — `motorway` is drawn by `routeSectionMotorwayLine`:

```ts
layers: {
    sections: {
        motorway: { routeSectionMotorwayLine: { paint: { 'line-dasharray': [2, 1] } } },
    },
}
```

---

### Layer positioning — `beforeLayerConfig`

Default: route lines below the map's labels, route icons above them. `beforeLayerConfig` takes one target (`'top'` or a `mapStyleLayerIDs` key) for the whole route, or a record keyed by part plus `all` for the parts it leaves out:

- `mainLines` — route lines and every section line drawn with them
- `instructionLines` — guidance lines and arrows (above the route lines by default)
- `icons` — waypoints, summary bubbles, border crossings, section icons (the tunnel sign and generated section icons lowest); a target puts them all beneath it, in that order

```ts
const routingModule = await RoutingModule.create(map, { beforeLayerConfig: { mainLines: 'lowestRoadLine' } });
routingModule.updateConfig({ beforeLayerConfig: 'top' }); // restacks at runtime, survives setStyle
routingModule.getLayerToRenderLinesUnder(); // follows mainLines; undefined when the lines are on top
```

A part keeps its own layers' order. A target the style lacks (satellite has no `lowestRoadLine`) puts the part on top. Section signs are not a part — `sign.priority` still decides what they give way to.

### MapLibre layer overrides (advanced)

Customize route line paint, add extra layers, modify section visuals:

```ts
import { defaultRoutingLayers, SELECTED_ROUTE_FILTER } from '@tomtom-org/maps-sdk/map';

const routingModule = await RoutingModule.create(map, {
    color: '#DF1B12',
    layers: {
        mainLines: {
            routeOutline: {
                paint: { 'line-color': '#555', 'line-width': 10 },
            },
            // add a new custom layer
            additional: {
                myDashLine: {
                    type: 'line',
                    filter: SELECTED_ROUTE_FILTER,
                    paint: { 'line-color': 'lightgrey', 'line-dasharray': [3, 2] },
                    beforeID: 'routeIncidentBackgroundLine',
                },
            },
        },
        sections: {
            tollRoad: {
                routeTollRoadSymbol: { layout: { 'icon-size': 0.8 } }, // fixed; the default grows with the zoom
                routeTollRoadOutline: {
                    paint: { 'line-color': '#29A2FF', 'line-dasharray': [1, 0.2] },
                },
            },
            tunnel: {
                routeTunnelLine: {
                    paint: {
                        ...defaultRoutingLayers.sections.tunnel?.routeTunnelLine?.paint,
                        'line-opacity': 1,
                    },
                },
            },
        },
    },
});
```

---

## RoutingModule — waypoint events

```ts
import { MIDDLE_INDEX } from '@tomtom-org/maps-sdk/map';
import type { WaypointDisplayProps } from '@tomtom-org/maps-sdk/map';
import type { Waypoint } from '@tomtom-org/maps-sdk/core';

// Click on any waypoint pin
routingModule.events.waypoints.on('click', (waypoint: Waypoint<WaypointDisplayProps>, lngLat) => {
    // START_INDEX 'start' | MIDDLE_INDEX 'middle' | FINISH_INDEX 'finish' — all from
    // '@tomtom-org/maps-sdk/map'.
    waypoint.properties.indexType;
    waypoint.properties.index;     // position in the waypoints array
    waypoint.properties.stopDisplayLabel; // the mark on a stop's pin: '1', 'A', or undefined

    if (waypoint.properties.indexType === MIDDLE_INDEX) {
        // intermediate stop clicked — offer to remove it
        const stopIndex = waypoint.properties.index - 1;
    }
});

// A handler makes the pins interactive: a hovered or clicked pin grows by
// `waypoints.highlight.sizeFactor`. Put the state from your own UI on the `waypoints` scope:
routingModule.events.waypoints.setEventState({ index: 1, state: 'hover' });
```

### Route section events

Beyond `mainLines` and `waypoints`, the module exposes click events for specific route section types:

```ts
routingModule.events.ferries.on('click', (section, lngLat) => { /* ferry segment */ });
routingModule.events.tollRoads.on('click', (section, lngLat) => { /* toll segment */ });
routingModule.events.tunnels.on('click', (section, lngLat) => { /* tunnel segment */ });
routingModule.events.vehicleRestricted.on('click', (section, lngLat) => { /* restricted area */ });
// Every generated section type has a scope of its own, keyed `<type>Sections`:
routingModule.events.urbanSections.on('click', (section, lngLat) => { /* urban stretch */ });
```

---

## Dynamic stop insertion with `withInsertedWaypoint` / `withInsertedWaypoints`

For a single new stop (e.g. a map click), use `withInsertedWaypoint`:

```ts
import { withInsertedWaypoint } from '@tomtom-org/maps-sdk/core';

let waypoints: WaypointLike[] = [origin, destination];
let currentRoute = routes.features[0];

// On map click: find optimal position and insert new stop
map.mapLibreMap.on('click', async (e) => {
    const newStop = e.lngLat.toArray() as [number, number];
    waypoints = withInsertedWaypoint(currentRoute, waypoints, newStop);

    const updated = await calculateRoute({ locations: waypoints });
    currentRoute = updated.features[0];
    routingModule.showWaypoints(waypoints);
    routingModule.showRoutes(updated);
});
```

For multiple new stops at once (e.g. the places `discoverPlaces` finds along a `route`), use `withInsertedWaypoints` — projections are computed once and the result is in along-route order regardless of input order:

```ts
import { withInsertedWaypoints } from '@tomtom-org/maps-sdk/core';
import { discoverPlaces, calculateRoute } from '@tomtom-org/maps-sdk/services';

const stops = await discoverPlaces({
    filters: { poiCategories: ['CHARGING_LOCATION'] },
    route: routes.features[0],
    maxDetourTimeSeconds: 300,
    limit: 5,
});

const updatedWaypoints = withInsertedWaypoints(
    routes.features[0],
    waypoints,
    stops.features.map((f) => f.geometry.coordinates as [number, number]),
);

const updatedRoutes = await calculateRoute({ locations: updatedWaypoints });
```

**Don't loop `withInsertedWaypoint` to insert N stops** — the plural variant projects everything once (O(n+m) instead of O(n·m)) and gives a deterministic along-route order independent of input order.

---

## GeometriesModule — full config

Guide: [geometries module](https://docs.tomtom.com/maps-sdk-js/guides/map/geometries.md).

```ts
import type { PolygonFeatures } from '@tomtom-org/maps-sdk/core';

// Display city boundaries (inverted = shade everything outside)
const geometriesModule = await GeometriesModule.create(map, {
    beforeLayerConfig: 'lowestPlaceLabel',
    fill: { style: 'inverted', color: 'white', opacity: 0.75 },
    line: { opacity: 0 },
});

const geometry = geometryData({ geometries: [place] });
await geometriesModule.show(geometry as PolygonFeatures);

// One colour for fill and border, a styled center label, labels along the border
const zones = await GeometriesModule.create(map, {
    color: '#E63312',
    label: { title: ['get', 'name'], size: 18, color: '#FFFFFF', haloColor: '#000000' },
    lineLabel: { minZoom: 10, size: 13, offset: [0, 1] },
});

// Hide fills, borders and their labels without dropping the data; `show()`/`clear()` never flip it
geometriesModule.setVisible(false); // or `visible: false` at create
geometriesModule.isVisible();       // false

// Fill and border apart: a part takes its own entry, else `all`. There is no `beforeLayerConfig`
// inside `fill` / `line` — this record is the only way to place a part. A part it names no target
// for goes back to its default (on top, just below the titles).
geometriesModule.updateConfig({ beforeLayerConfig: { fill: 'lowestRoadLine', line: 'lowestLabel' } });

// Your own colours, one per feature in turn — neighbouring regions stay apart
const regions = await GeometriesModule.create(map, { fill: { palette: ['#ffadad', '#ffd6a5', '#caffbf', '#a0c4ff'], opacity: 0.3 } });

// Any MapLibre property the curated fields lack: a partial layer per layer, merged over the curated fields
geometriesModule.updateConfig({
    layers: {
        line: { paint: { 'line-dasharray': [2, 2], 'line-blur': 4 }, layout: { 'line-cap': 'round' } },
        label: { layout: { 'text-transform': 'uppercase' } },
    },
});
```

- **`layers`** (`GeometryLayersConfig`: `fill`, `line`, `label`, `lineLabel`) — `paint`/`layout` merge per property and win over the curated fields; a `beforeID` is ignored (`beforeLayerConfig` places the layers); `layout.visibility: 'none'` keeps that layer hidden while shown; `updateConfig({ layers })` repaints without re-preparing.

- **Colour precedence** — fill: a feature's `color` property → `fill.color` → `fill.palette` → `color` → the map's accent → theme-adaptive default. Border: `line.color` → a feature's `color` → `fill.color` → `fill.palette` → `color` → accent → default (`fill.style: 'outline'` ends on neutral grey instead). `fill.color` takes a CSS colour or a MapLibre expression; `fill.palette` a list of CSS colours (no named palettes; `[]` counts as unset, and unset every feature draws in the accent). To match the map, take them from `deriveMapColors` (`map-theming.md`). Set `color` only when the user asks for a specific colour; otherwise the accent follows a map theme.
- **`fill.style`** (`GeometryFillStyle`: `'filled'` | `'outline'` | `'inverted'`) — config-wide, or per feature in `properties.fillStyle`; `fillStyledGeometryConfig({ palette?, beforeLayerConfig? })` styles mixed fill styles in one module, and draws the border labels too.
- **Ids**: `setEventState({ id })` and the handlers go by `properties.id`, generated when a feature lacks one; a top-level `feature.id` (a `geometryData` result's) is ignored.
- **Hovered or clicked** (with any handler, or `setEventState`): a denser fill and a wider border, in the geometry's own colour — `highlight.fill.opacityFactor` (default 2, clamped 1–4, at most opaque) and `highlight.line.widthFactor` (1.75, 1–3) times the opacity and width in force, a configured `fill.opacity` / `line.width` included. Set both to `1` to keep the look fixed. A `layers.line` `line-width` is drawn as given in every state.
- **`label`** (`GeometryLabelConfig`) styles the center label, `updateConfig({ label })` at runtime (it replaces the whole label); **`lineLabel`** (`GeometryLineLabelConfig`, adding `minZoom`, `symbolSpacing`, `offset`) draws along the border only when set — `{}` for defaults. Both take `title` (string or expression, default `['get', 'title']`) and `LabelConfig`: `size`, `color`, `haloColor`, `haloWidth`, `opacity`, `font`.

### Every knob as data — `geometriesKnobCatalogue`

`geometriesKnobCatalogue` lists every plain-valued `GeometriesModuleConfig` display setting as a
`GeometriesKnob` (the shared `KnobEntry` shape): `id`, `kind`, `description`, a `range` or `options`
and, where one value holds everywhere, a `default`. The id is the setting's path in the config;
`geometriesKnobIds` lists them, `GeometriesKnobId` is their union and `GeometriesKnobValueOf<ID>`
the plain value one takes (the config also accepts MapLibre expressions at most paths; those are
not knob values).

```ts
import { geometriesKnobCatalogue, type GeometriesModuleConfig } from '@tomtom-org/maps-sdk/map';

const width = geometriesKnobCatalogue.find(({ id }) => id === 'line.width');
// { id: 'line.width', kind: 'number', range: { min: 0, max: 20, step: 0.5, bounds: 'hard-min' }, description: '…' }
const config: GeometriesModuleConfig = { line: { width: width?.range?.max } };
```

| Id | Kind | Default |
|---|---|---|
| `color` | color | accent, else theme navy |
| `visible` | toggle | `true` |
| `fill.style` | enum | `'filled'` |
| `fill.color` | color | — |
| `fill.palette` | colors | — (one colour, the accent) |
| `fill.opacity` | number 0–1 | 0.15, 0 for `outline` |
| `line.color` | color | — |
| `line.opacity` | number 0–1 | 1, 0.9 for `outline` |
| `line.width` | number, pixels | 2, 5 for `outline` |
| `highlight.fill.opacityFactor` | factor, 1–4 | `2` |
| `highlight.line.widthFactor` | factor, 1–3 | `1.75` |
| `label.size` | number, pixels | 15 |
| `label.color` | color | theme |
| `label.haloColor` | color | theme |
| `label.haloWidth` | number, pixels | grows with zoom |
| `label.opacity` | number 0–1 | 1 |
| `label.font` | enums (`mapFonts`), first available wins | — (`Noto-Bold` in the labels' typeface) |
| `label.typeface` | enum (`mapTypefaces`), `font` wins over it | — (the map's typeface) |
| `lineLabel.size` | number, pixels | 15 |
| `lineLabel.color` | color | theme |
| `lineLabel.haloColor` | color | theme |
| `lineLabel.haloWidth` | number, pixels | 2 |
| `lineLabel.opacity` | number 0–1 | 1 |
| `lineLabel.font` | enums (`mapFonts`), first available wins | — (`Noto-Bold` in the labels' typeface) |
| `lineLabel.typeface` | enum (`mapTypefaces`), `font` wins over it | — (the map's typeface) |
| `lineLabel.minZoom` | number 0–22 | 3 |
| `lineLabel.symbolSpacing` | number, pixels | 200 |
| `lineLabel.offset` | offset, ems, −5 to 5 per axis | `[0, 1]` |

- Setting any `lineLabel.*` knob draws the border labels, which are off until `lineLabel` is set.
- Not knobs: `beforeLayerConfig`, `layers`, the labels' `title`, `transformFeaturesForDisplay`, `events`.
- Entry shape and kinds: `map-setup.md` § Every setting as data.

---

## Gotchas

- `showRoutes()` draws the lines, sections, guidance and summary bubbles, but no pins; `showWaypoints()` draws the pins — always call both
- `maxAlternatives: 2` returns up to 3 routes; index 0 is the recommended route
- The `tollRoads` overlay draws the `tollRoad` sections, not the `toll` ones — every charged stretch, vignette motorways and city charge zones included, all with the toll-plaza icon
- `leg.originalWaypointIndex` is `undefined` on the final leg and on legs ending somewhere the caller did not ask for — handle it rather than assuming a number
- `selectRoute(index)` highlights an alternative without recalculating
- `SELECTED_ROUTE_FILTER` is a MapLibre filter expression — use it in `additional` layers to limit them to the active route
- `MIDDLE_INDEX` is the `indexType` value for intermediate stops (not a number — compare with `===`)
- Every point in `locations` ends a leg and draws a numbered pin — three points give two legs. A path's endpoints count too, so there is no way to shape a route without adding waypoints
- `showWaypoints` takes `PlanningWaypoint[]`, where a `null` is an unset planner slot: it draws no pin but keeps its position, so the stops after it keep their numbers
- `clearRoutes()` does NOT clear waypoints — call `clearWaypoints()` separately if needed
- Only `'car'` travel mode is supported — truck, motorcycle, bicycle, pedestrian are not available in the current API
- `vehicle.model.dimensions` takes `weightKG` only — there are no height, width, length or axle-weight restrictions to route a truck by
- Event handlers on overlapping source/layer IDs (e.g., two modules sharing layers) — only the first handler fires
- Long-hover events are suppressed on features already in "clicked" state
- An aborted call rejects with `SDKAbortError` (`name === 'AbortError'`), which has no `status` — match the class before any `error.status` check, or a cancellation reads as an unknown failure
- For map-wide traffic overlays (flow layer, incidents layer) see `docs/traffic.md`
