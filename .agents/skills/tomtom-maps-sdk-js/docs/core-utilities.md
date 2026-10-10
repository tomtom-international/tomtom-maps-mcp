# Core Utilities Reference

## Imports

```ts
import {
    bboxFromGeoJSON, bboxFromCoordsArray, bboxFromBBoxes, isBBoxWithArea, bboxCenter, polygonFromBBox,
    getPosition,
    formatDistance, formatDuration,
    findBestWaypointInsertionIndex, findBestWaypointInsertionIndices,
    withInsertedWaypoint, withInsertedWaypoints,
    getSectionBBox,
    calculateProgressAtRoutePoint, getRouteProgressBetween,
    getRouteProgressForSection, getCoordinateAtRouteProgress,
    getProgressAtNearestRoutePoint,
} from '@tomtom-org/maps-sdk/core';
```

---

## Bounding boxes

### `bboxFromGeoJSON`

Extracts or calculates `[west, south, east, north]` from any GeoJSON object or array of them. An existing `bbox` wins; otherwise it is calculated from the geometry, sampling lines longer than 1000 points (use `getSectionBBox` or turf for an exact box).

```ts
// From a geocoded place (uses the place's own bbox — often a city-level area)
const place = await geocodeOne('Amsterdam');
const bbox = bboxFromGeoJSON(place);            // [minLng, minLat, maxLng, maxLat] | undefined

// From a FeatureCollection (encompasses all features)
const places = await discoverPlaces({ query: 'coffee', geoBias: { position: [4.9, 52.4] } });
const bbox = bboxFromGeoJSON(places);

// From a route geometry
const bbox = bboxFromGeoJSON(route.features[0].geometry);

// From an array of objects
const bbox = bboxFromGeoJSON([place1, place2, place3]);
```

Returns `[minLng, minLat, maxLng, maxLat] | undefined`.

### `bboxFromCoordsArray`

Calculates bbox from a flat array of `[lng, lat]` coordinates — useful when you have raw coordinate pairs (e.g., multiple origins/destinations) rather than GeoJSON objects. Samples arrays longer than 1000 positions, like `bboxFromGeoJSON`; `undefined` for an empty array.

```ts
const bounds = bboxFromCoordsArray([[4.9, 52.4], [2.3, 48.8], [13.4, 52.5]]);
// → [2.3, 48.8, 13.4, 52.5]
```

### `bboxFromBBoxes`

The bbox containing every given one, skipping `undefined` entries — combine `bboxFromGeoJSON` results without null checks. `undefined` when none is defined.

```ts
const bounds = bboxFromBBoxes([bboxFromGeoJSON(city), bboxFromGeoJSON(cafes)]);
```

### `isBBoxWithArea` and `bboxCenter`

`isBBoxWithArea(bbox)` is `false` for `undefined` and for a box with no width or no height (one point, or a line along a meridian or parallel) — fitting the map to such a box zooms in as far as it goes. `bboxCenter(bbox)` gives the box's `[lng, lat]` centre, to centre on instead.

```ts
const bbox = bboxFromGeoJSON(places);
if (isBBoxWithArea(bbox)) map.mapLibreMap.fitBounds(bbox, { padding: 50 });
else if (bbox) map.mapLibreMap.jumpTo({ center: bboxCenter(bbox), zoom: 15 });
```

### `polygonFromBBox`

Converts a bbox to a GeoJSON `Feature<Polygon>` — useful for displaying a search area on the map.

```ts
const bbox = bboxFromGeoJSON(places);
if (bbox) {
    const bboxPolygon = polygonFromBBox(bbox);
    // use with GeometriesModule.show() or map.mapLibreMap.addSource(...)
}
```

---

## Coordinates

### `getPosition`

Extracts `[longitude, latitude]` from any of: raw array, Point geometry, or Place Feature.

```ts
getPosition([4.9, 52.3]);                          // → [4.9, 52.3]
getPosition({ type: 'Point', coordinates: [...] }); // → [lng, lat]
getPosition(place);                                 // → [lng, lat] from geometry

// Prefer building entrance over geometry centroid
getPosition(place, { useEntryPoint: 'main-when-available' });
```

Returns `[longitude, latitude] | null`.

---

## Formatting

### `formatDuration`

Formats seconds to a human-readable time string. Returns `undefined` if under 30 seconds.

```ts
formatDuration(0);       // undefined
formatDuration(60);      // '1 min'
formatDuration(1800);    // '30 min'
formatDuration(3660);    // '1 hr 01 min'

// Custom units
formatDuration(3660, { hours: 'h', minutes: 'm' });  // '1 h 01 m'

// Route travel time
const { travelTimeInSeconds } = routes.features[0].properties.summary;
formatDuration(travelTimeInSeconds);
```

### `formatDistance`

Formats meters to a human-readable distance string. Supports metric, US imperial, UK imperial.

```ts
formatDistance(950);     // '1 km'
formatDistance(2850);    // '2.9 km'

// Imperial
formatDistance(205.95, { type: 'imperial_us' });  // '¼ mi'
formatDistance(150.88, { type: 'imperial_uk' });  // '170 yd'

// Custom labels
formatDistance(1500, { type: 'metric', kilometers: 'KM' });  // '1.5 KM'

// Route distance
const { lengthInMeters } = routes.features[0].properties.summary;
formatDistance(lengthInMeters);
```

### Global default units

```ts
TomTomConfig.instance.put({
    displayUnits: {
        distance: { type: 'imperial_us', feet: 'ft', miles: 'mi' },
        time: { hours: 'hr', minutes: 'min' },
    },
});
// formatDistance() and formatDuration() use these; a per-call options argument overrides them key by key
```

See [Formatting](https://docs.tomtom.com/maps-sdk-js/guides/core/utilities/formatting.md).

---

## Route waypoint utilities

### `withInsertedWaypoint`

Finds the optimal position and inserts a new waypoint into an existing waypoints array without modifying the original.

```ts
const waypoints = [origin, destination];
const newStop = [4.95, 52.35];

const updatedWaypoints = withInsertedWaypoint(routes.features[0], waypoints, newStop);
// → [origin, newStop, destination]

const updatedRoutes = await calculateRoute({ locations: updatedWaypoints });
```

### `withInsertedWaypoints`

Multi-waypoint variant. All projections are computed in a single pass against the original route, then new waypoints are bucketed into slots and sorted within each slot by their along-route location (with stable input-order tie-breaking). The result is independent of input order.

```ts
const waypoints = [origin, destination];
// stops can be passed in any order — the result settles into along-route order
const stops = [pointFurther, pointCloser];

const updated = withInsertedWaypoints(routes.features[0], waypoints, stops);
// → [origin, pointCloser, pointFurther, destination]

const updatedRoutes = await calculateRoute({ locations: updated });
```

Use this whenever you have N new stops (e.g. POIs `discoverPlaces` finds along a `route`) and want to merge them into the route in one shot. Don't call `withInsertedWaypoint` in a loop — the plural variant is O(n+m) on projections and produces correctly ordered output regardless of input order.

### `findBestWaypointInsertionIndex`

Returns the index at which to insert a new waypoint.

```ts
const idx = findBestWaypointInsertionIndex(routes.features[0], waypoints, newStop);
// idx=1 → insert between waypoints[0] and waypoints[1]
```

### `findBestWaypointInsertionIndices`

Multi-waypoint variant. Returns one slot index per new waypoint, computed in a single pass against the original existing waypoints. Multiple new waypoints may share the same slot. When you also need them merged in correct along-route order, use `withInsertedWaypoints` (which adds within-slot ranking on top of these slot indices).

```ts
const slots = findBestWaypointInsertionIndices(route, existing, [stopA, stopB, stopC]);
// e.g. [1, 2, 1] → A and C both fall between existing[0] and existing[1]; B between [1] and [2]
```

---

## Route section bbox

### `getSectionBBox`

Returns `[minLng, minLat, maxLng, maxLat]` for any route section (uses start, mid, end points for speed).

```ts
const route = routes.features[0];
const countrySections = route.properties.sections.country;

for (const section of countrySections ?? []) {
    const bbox = getSectionBBox(route, section);
    if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 40 });
}
```

---

## Route progress utilities

These functions require `route.properties.progress`, present unless the route was calculated with `extendedRouteRepresentations: []`. Between two `progress` entries they follow the line's length, not its vertex count, so equal steps of distance cover equal ground.

### `calculateProgressAtRoutePoint`

Distance and time at a specific coordinate index along the route.

```ts
const progress = calculateProgressAtRoutePoint(route, 10);
// → { distanceInMeters, travelTimeInSeconds } | undefined
```

### `getRouteProgressBetween` / `getRouteProgressForSection`

Distance and time for a segment between two coordinate indices, or directly from a section object.

```ts
const segment = getRouteProgressBetween(route, 5, 20);
// → { start, end, delta: { distanceInMeters, travelTimeInSeconds } } | undefined

const section = route.properties.sections.traffic?.[0];
if (section) {
    const sp = getRouteProgressForSection(route, section);
    sp && console.log(`${sp.delta.travelTimeInSeconds}s through the jam`); // travel time, not delay: that is section.delayInSeconds
}
```

### `getCoordinateAtRouteProgress`

Position on the route at a given elapsed time, distance, or absolute clock time.

```ts
// By elapsed time
const byTime = getCoordinateAtRouteProgress(route, { traveledTimeInSeconds: 600 });

// By distance
const byDist = getCoordinateAtRouteProgress(route, { traveledDistanceInMeters: 5000 });

// By clock time (relative to route departure)
const byClock = getCoordinateAtRouteProgress(route, { clockTime: new Date('2025-06-01T09:10:00Z') });

byTime && console.log(`At 10 min: [${byTime.position}]`);
// → { position: [lng, lat], distanceInMeters, travelTimeInSeconds }
```

### `getProgressAtNearestRoutePoint`

Snaps an arbitrary point to the nearest position on the route — useful for hover/click interactions.

```ts
map.mapLibreMap.on('mousemove', (e) => {
    const result = getProgressAtNearestRoutePoint(route, e.lngLat.toArray());
    if (result) {
        showTooltip(`${formatDistance(result.distanceInMeters)} from start`);
    }
});
// → { position: [lng, lat], distanceInMeters, travelTimeInSeconds } | undefined
```

See [Route utilities](https://docs.tomtom.com/maps-sdk-js/guides/core/utilities/routes.md).
