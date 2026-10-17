# Landmarks 3D Plugin Reference

Renders TomTom Orbis **3D Landmarks** — high-detail building meshes streamed as GLB tiles — on a `TomTomMap`, drawn with Three.js through a MapLibre custom layer and shaded to blend with the basemap's 3D buildings.

> [Private preview](https://docs.tomtom.com/legal/private-preview) — package is `@tomtom-org/maps-sdk-plugin-landmarks-3d`. Tiles need an API key with Orbis 3D Landmarks entitlements.

## Imports

```ts
import {
    Landmarks3D,
    type Landmarks3DOptions,
    type Landmarks3DDisplayMode,
    // advanced: the custom layer and its tile URL, for building the layer yourself
    buildLandmarksTileURL,
    ModelsLayer,
    ModelsSource,
    type ModelsLayerSpecification,
    type ModelsSourceSpecification,
} from '@tomtom-org/maps-sdk-plugin-landmarks-3d';
```

Guide: [Landmarks 3D plugin](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d.md).

## Installation

```bash
npm i @tomtom-org/maps-sdk maplibre-gl @tomtom-org/maps-sdk-plugin-landmarks-3d three
```

`three`, `maplibre-gl` and `@tomtom-org/maps-sdk` are peer dependencies — the app installs them (the SDK already requires `maplibre-gl`); the plugin never bundles them.

## Quick start

```ts
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { Landmarks3D } from '@tomtom-org/maps-sdk-plugin-landmarks-3d';

TomTomConfig.instance.put({ apiKey: 'YOUR_API_KEY' });

const map = new TomTomMap({
    mapLibre: { container: 'sdk-map', center: [4.9003, 52.3791], zoom: 16, pitch: 60 },
});

// Starts rendering once the map is ready; the tile URL is built from TomTomConfig.
const landmarks = new Landmarks3D(map);
```

Use a **pitched camera** (`pitch > 0`) to see the meshes. The plugin enables the standard style's hidden `3D - Building` layer automatically, so landmarks sit in a full 3D city context.

## Constructor & options

`new Landmarks3D(map: TomTomMap, options?: Landmarks3DOptions)` — no `await`; rendering starts when the map becomes ready.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `displayMode` | `'inherited' \| 'dark' \| 'light'` | `'inherited'` | How landmarks are shaded (see below) |
| `visible` | `boolean` | `true` | Initial visibility |
| `minZoom` | `number` | basemap 3D building layer's min; `10` without it | Zoom at which landmarks appear |
| `maxZoom` | `number` | basemap 3D building layer's max; `22` without it | Zoom at which landmarks disappear |
| `withCredentials` | `boolean` | `isProxyCredentialsMode()` | Send `credentials: 'include'` with tile requests (proxy session cookie) |

When `minZoom`/`maxZoom` are omitted the range tracks the basemap 3D building layer, so landmarks appear and disappear together with it.

## Display modes

Every mode renders landmarks as maplibre-style fill-extrusion buildings.

- `inherited` (default) — mirrors the **colour, opacity and vertical gradient** of the basemap 3D building layer, so landmarks blend in. Falls back to the `light` look when that layer is absent or its colour is not one value (a `match` uses its default operand).
- `dark` — the 3D-building look of the `streetDark` style (`hsl(210, 9%, 17%)`, opacity 0.7).
- `light` — the 3D-building look of the `streetLight` style (`hsl(38, 6%, 90%)`, opacity 0.7).

## Methods

```ts
await landmarks.setDisplayMode('dark'); // change shading at runtime
landmarks.getDisplayMode();             // 'inherited' | 'dark' | 'light'

await landmarks.setVisible(false);      // hide / show
landmarks.isVisible();                  // boolean

landmarks.layer;                        // the underlying ModelsLayer (advanced use)
```

## How it works

- Adds a MapLibre **custom layer** (`ModelsLayer`, id `orbis-3d-landmarks`) that fetches the GLB tiles covering the viewport and renders them with Three.js, keeping lighting in sync with the map style light.
- **Frames on demand**: the layer draws when the map draws and requests a frame only when a tile arrives, so a still map stays idle. After writing a `landmarks.layer` field yourself (`diffuseColor`, `visible`), call `map.mapLibreMap.triggerRepaint()`.
- Inserted before `mapStyleLayerIDs.poi` (on top when the style lacks it), so POIs draw over the meshes and roads stay below.
- Shows the standard style's hidden `3D - Building` layer for city context, and filters basemap extrusions flagged `has_landmark` out of that layer so they don't clip through the high-detail meshes.
- The layer, its visibility, and the filter are all re-applied after map style changes.
- **3D terrain**: with `TerrainModule` elevation on, each landmark is lowered onto the lowest terrain under its footprint every frame, so it follows terrain tiles as they load and exaggeration changes. Nothing to configure.

## Gotchas

- **Entitlement**: tiles load only with an API key entitled for Orbis 3D Landmarks (private preview); otherwise the map renders without landmarks, and the console warns per tile that the key needs that access, with where to request it.
- **Pitch**: with a top-down camera the meshes look flat — pitch the camera.
- **Tile URL**: built automatically from `TomTomConfig` (`apiKey`, `commonBaseURL`); proxy mode (empty `apiKey`) omits the `key` param. `buildLandmarksTileURL()` is exported if you need the template directly.
- **`minZoom` far below 15**: landmark tiles exist at zoom 15 only, so each zoom level below it quadruples the tiles a view needs (16× at zoom 13), more on a pitched camera. With several maps on a page the browser runs out of connections (`ERR_INSUFFICIENT_RESOURCES`). Keep `minZoom` near 15.
- **Several maps**: one `new Landmarks3D(map)` per map, each loading its own view's tiles. Each map is a WebGL context and browsers cap them per page (16 in Chrome), so move the maps you have rather than creating more. Three.js logs `Multiple active KTX2 loaders`; harmless.
- **Framing a tall landmark**: aim at its mid-height with `centerClampedToGround: false` in the map's `mapLibre` options plus a camera `elevation` in metres. MapLibre's `flyTo`/`easeTo` keep the previous `elevation`, so move with `jumpTo({ center, elevation, … })`.
- **Peer deps**: `three` must be present in the app's dependency tree.
- **KTX2 transcoder**: landmark textures are KTX2; the Basis Universal transcoder ships with the plugin in a lazy chunk (no CDN request). A strict CSP needs `data:` in `connect-src` and `blob:` in `worker-src`. `Landmarks3D` always uses the bundled copy; to serve your own, build `new ModelsLayer(layerSpecification, { ...sourceSpecification, transcoderPath })` with `tiles: [buildLandmarksTileURL()]` yourself.
