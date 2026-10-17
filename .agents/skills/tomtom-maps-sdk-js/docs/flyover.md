# Fly-over Plugin Reference

A camera that flies a calculated route on a `TomTomMap`: it follows the line, aims at the junctions ahead, frames them, keeps clear of the terrain it crosses, and parks the followed position — marked with an arrow — where you want it on screen.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-flyover`.

## Imports

```ts
import {
    anchorForPitch,
    RouteFlyover,
    type FlyoverAim,
    type FlyoverAnchor,
    type FlyoverCamera,
    type FlyoverMarkerConfig,
    type FlyoverMarkerImage,
    type FlyoverProgress,
    type FlyoverZoom,
    type RouteFlyoverOptions,
} from '@tomtom-org/maps-sdk-plugin-flyover';
```

## Installation

```bash
npm i @tomtom-org/maps-sdk maplibre-gl @tomtom-org/maps-sdk-plugin-flyover
```

`@tomtom-org/maps-sdk` and `maplibre-gl` are peer dependencies; the plugin never bundles them. Guide: [Fly-over plugin](https://docs.tomtom.com/maps-sdk-js/guides/plugins/flyover.md).

## Quick start

```ts
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { calculateRoute } from '@tomtom-org/maps-sdk/services';
import { RouteFlyover } from '@tomtom-org/maps-sdk-plugin-flyover';

TomTomConfig.instance.put({ apiKey: 'YOUR_API_KEY' });

const map = new TomTomMap({ style: 'streetSatellite', mapLibre: { container: 'map', maxPitch: 85 } });
// `guidance` unlocks the two modes that read the junctions ahead.
const routes = await calculateRoute({ locations: [origin, destination], guidance: { type: 'coded' } });

const flyover = new RouteFlyover(map, {
    route: routes.features[0],
    camera: { speedKMH: 300, pitch: 76 },
    onProgress: ({ traveledDistanceInMeters, traveledTimeInSeconds }) => update(traveledDistanceInMeters),
});
flyover.start();
```

## What the route must carry

- **`progress`** — cumulative distance/time per point. Calculated routes carry it by default; it is what the flight reads its position from.
- **`guidance`** (optional) — read by `aim: { mode: 'instruction' }` and `zoom: { mode: 'instructions' }`. Request with `guidance: { type: 'coded' }`. Without it the aim uses `fallbackMetersAhead` and the zoom holds 14.

The flight **loops**: it wraps at the destination and starts again, so it never lands.

## Camera

Every field can be changed mid-flight with `setCamera()`; every one has a default.

| Field | Meaning | Default |
|---|---|---|
| `speedKMH` | ground speed of the camera | `200` |
| `pitch` | tilt in degrees (map's `maxPitch` is the ceiling) | `70` |
| `aim` | what the camera looks at ahead | `{ mode: 'instruction', fallbackMetersAhead: 250 }` |
| `zoom` | what sets the camera height | `{ mode: 'instructions', instructionsAhead: 2 }` |
| `anchor` | where the followed position sits on screen | derived from `pitch` |

### `FlyoverAim`

```ts
{ mode: 'instruction'; fallbackMetersAhead: number }  // the next junction — default
{ mode: 'distance'; metersAhead: number }             // fixed distance down the road
{ mode: 'points'; pointsAhead: number }               // N route vertices — shortens through bends
```

### `FlyoverZoom`

```ts
{ mode: 'instructions'; instructionsAhead: number }  // fit the next N (≥ 1) junctions — default
{ mode: 'speed' }                                    // 14 at 90 km/h, one level out per doubling
{ mode: 'fixed'; zoom: number }
```

- The two automatic modes clamp to zoom 11..15.
- In every mode the camera pulls back further where terrain would come between it and the road.

### `FlyoverAnchor` — where the position sits on screen

```ts
type FlyoverAnchor = { x: number; y: number }; // fractions of the viewport; { 0.5, 0.5 } is the middle
```

Omitted, it follows the pitch: centred when level, sliding to two thirds down by 60°, so a top-down pass needs no mode of its own.

```ts
flyover.setCamera({ anchor: { x: 0.5, y: 0.67 } }); // explicit
anchorForPitch(76); // → { x: 0.5, y: 0.667 }: what a given pitch would choose
```

- Applied as viewport `padding`, each fraction clamped to 0.05..0.95; `remove()` restores the map's own padding.
- The camera looks at the road on the ground, so the anchor holds over terrain; a changed anchor is eased onto.

## Marker

An arrow rides the route at the followed position, lying on the map and facing the road. `marker` in the options, `setMarker()` mid-flight — it replaces the whole config, fields left out return to their defaults.

```ts
type FlyoverMarkerConfig = {
    visible?: boolean;            // default true
    image?: FlyoverMarkerImage;   // default { type: 'arrow' }
    size?: number;                // pixels, before the pitch foreshortens it; default 44
};
type FlyoverMarkerImage =
    | ({ type: 'arrow' } & SVGIconStyleOptions)                  // fillColor, outlineColor, outlineOpacity
    | { type: 'custom'; image: string | HTMLImageElement };       // URL, raw SVG, data URI or loaded <img>, pointing up

flyover.setMarker({ image: { type: 'arrow', fillColor: '#e2231a' } });
flyover.setMarker({ image: { type: 'custom', image: carSvg }, size: 56 });
flyover.setMarker({ visible: false });
```

- Default arrow: `ROUTE_LINE_OUTLINE_COLOR` fill, white outline. It does not follow a theme's accent; pass `fillColor: map.mapColors.accent` to match a themed route.
- A MapLibre custom layer (one textured quad, re-added after style changes): `MapEffects` and captures include it.
- Placed as each frame is drawn, on the terrain under its route point, independent of the camera.
- Mercator projection only; a custom image URL on another origin needs CORS (it becomes a WebGL texture).

## Methods

| Method | Effect |
|---|---|
| `start()` | start or resume the flight, ramping up to speed |
| `stop()` | freeze where it is |
| `seek(fraction)` | jump to a share of the route's length, clamped to 0..1 |
| `setRoute(route)` | fly a different route, from its start |
| `setCamera(partial)` | merge speed, pitch, aim, zoom or anchor; before the first `start()`/`seek()` the page keeps the view |
| `getCamera()` | the camera in use, defaults included |
| `setMarker(config)` | replace the marker config (restyle, swap the image, hide) |
| `remove()` | stop, take the marker off, restore the padding the map had before the flight |
| `running` | whether the flight is advancing |

## Terrain

- **Clearance**: where a ridge behind the road would block the view, the camera zooms out along the same view until it is 200 m above the ground; pitch and anchor are untouched.
- **Altitude**: while running, the flight sets the centre's altitude (the ground under the road, eased), so `start()` calls `setCenterClampedToGround(false)` and `stop()` restores the map's own value.
- **No terrain** (`TerrainModule.get(map, { elevation: { visible: true } })` raises it, see `map-setup.md`): nothing to clear; the camera looks at sea level.

## Smoothness and cost

- **Critically damped springs** move heading, zoom, pitch, anchor and altitude: no overshoot, no velocity jump on a new target, a speed ramp on start. Solved exactly, so identical at 30, 60 or 120 fps.
- **Five times a second** the flight decides the heading (changes under 2.5° ignored, turns capped at 22°/s), the framing and the terrain clearance; per frame it only steps springs and moves the camera.
- `onProgress` fires on that tick and on `seek()`, not per frame.

## Gotchas

- **`maxPitch`** defaults to 60 in MapLibre; a flight above that needs `mapLibre: { maxPitch: 85 }` on the map.
- **The camera is the plugin's while it runs**: anything else calling `jumpTo`/`easeTo` or re-clamping the centre fights it. Pause first.
- **`aim: { mode: 'instruction' }` resolves through the instruction's `routeOffsetInMeters`**, not its `maneuverPoint`, which can sit a few metres off the sampled line.
- **A custom marker image is drawn pointing up** (north at bearing 0); the plugin rotates it to the road.
