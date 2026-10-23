# Landmarks 3D Plugin Reference

Renders TomTom Orbis **3D Landmarks** — high-detail building meshes streamed as GLB tiles — on a `TomTomMap`, drawn with Three.js through a MapLibre custom layer and shaded to blend with the basemap's 3D buildings.

> [Private preview](https://docs.tomtom.com/legal/private-preview) — package is `@tomtom-org/maps-sdk-plugin-landmarks-3d`. Tiles need an API key with Orbis 3D Landmarks entitlements. `Buildings3D` (see Buildings 3D) is in [Public preview](https://docs.tomtom.com/legal/public-preview) and works with any key.

## Imports

```ts
import {
    Landmarks3D,
    type Landmarks3DOptions,
    type Landmarks3DConfig,
    landmarks3DKnobCatalogue,
    landmarks3DKnobIds,
    type Landmarks3DKnob,
    type Landmarks3DKnobId,
    type Landmarks3DKnobValueOf,
    landmarkTextureUses,
    type LandmarkTextureUse,
    // advanced: the custom layer and its tile URL, for building the layer yourself
    buildLandmarksTileURL,
    ModelsLayer,
    ModelsSource,
    type ModelsLayerSpecification,
    type ModelsSourceSpecification,
    // the base map's buildings in 3D, with facades, lights and shadows
    Buildings3D,
    type Buildings3DConfig,
    buildings3DKnobCatalogue,
    buildings3DKnobIds,
    type Buildings3DKnob,
    type Buildings3DKnobId,
    type Buildings3DKnobValueOf,
    buildingsPresets,
    type BuildingsPreset,
    facadePatterns,
    type FacadePattern,
    type BuildingsLayer,
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
import { BaseMapModule, TomTomMap } from '@tomtom-org/maps-sdk/map';
import { Landmarks3D } from '@tomtom-org/maps-sdk-plugin-landmarks-3d';

TomTomConfig.instance.put({ apiKey: 'YOUR_API_KEY' });

const map = new TomTomMap({
    mapLibre: { container: 'sdk-map', center: [4.9003, 52.3791], zoom: 16, pitch: 60 },
});

// The 3D city around the landmarks: buildings3D ships hidden in every standard style but the driving ones.
await BaseMapModule.get(map, { groups: { buildings3D: { visible: true } } });
// Starts rendering once the map is ready; the tile URL is built from TomTomConfig.
const landmarks = new Landmarks3D(map);
```

Use a **pitched camera** (`pitch > 0`) to see the meshes. `Landmarks3D` never shows or hides `3D - Building`: its visibility is the `BaseMapModule`'s `buildings3D` group, so show it there for a 3D city context, or leave it out for landmarks alone.

## Constructor & options

`new Landmarks3D(map: TomTomMap, options?: Landmarks3DOptions)` — no `await`; rendering starts when the map becomes ready. `Landmarks3DOptions` is the knobs (`Landmarks3DConfig`) plus:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `withCredentials` | `boolean` | `isProxyCredentialsMode()` | Send `credentials: 'include'` with tile requests (proxy session cookie). Not a knob: `getConfig()` leaves it out |
| `transcoderPath` | `string` | the two files shipped in the plugin's `dist/` | Base path, ending in `/`, of `basis_transcoder.js` and `basis_transcoder.wasm` on the app's own host. Not a knob: `getConfig()` leaves it out |

## Knobs

The look is a flat set of knobs, each id its key in `Landmarks3DConfig`. Every knob but `visible` **follows the base map's `3D - Building` layer while unset**, each on its own:

| Knob | Kind | Range | Unset |
|---|---|---|---|
| `visible` | toggle | — | `true` |
| `color` | color | CSS colour | the 3D buildings' `fill-extrusion-color` (a `match` uses its default operand) |
| `texture` | enum | `landmarkTextureUses`: `mask` (the texture only carves the silhouette; shaded in `color`), `detail` (its light and shade over `color`), `color` (its own colours in place of `color`) | `mask`; `detail` while a `Buildings3D` draws |
| `opacity` | number | 0–1 | the 3D buildings' `fill-extrusion-opacity` |
| `verticalGradient` | toggle | — | the 3D buildings' `fill-extrusion-vertical-gradient` |
| `minZoom` | number | 0–22 | the 3D buildings' `minzoom` |
| `maxZoom` | number | 0–22 | the 3D buildings' `maxzoom`; landmarks stay drawn up to the next whole zoom |

- **Follows the style live**: an unset knob is re-read on every MapLibre `styledata`, so it follows `setStyle`, the map colours that recolour the 3D buildings (`styling.setMapColors(...)`, a `colors.artificial`/`colors.land` knob, a map-theme theme) and a raw `setPaintProperty('3D - Building', …)`. It repaints only when the look changed. A knob set always wins.
- **With a visible `Buildings3D` on the map** (it hides `3D - Building`): unset `color`, `opacity` and `minZoom` follow its resolved `walls.color`, `opacity` and `minZoom` instead, unset `texture` is `detail`, and the landmarks are drawn in its scene, under its sun and in its shadows (see Buildings 3D). Hidden again, they follow `3D - Building`.
- **The landmarks' own colours**: `updateConfig({ texture: 'color' })`. Every landmark mesh carries a colour texture; `color` samples it inside the same materials, so the style light's colour and intensity (or a `Buildings3D`'s sun, sky and shadows), `opacity` and `verticalGradient` keep applying. The textures carry no baked sun, so they are shaded once. Don't override `layer.getMaterial()` to return `mesh.userData.originalMaterial`: it isn't supported, the authored material skips `opacity`, `verticalGradient` and the style light's colour (its three.js lights stay white), and a `Buildings3D` never calls `getMaterial()`.
- **Fallback**: where the style has no `3D - Building` layer (`streetSatellite`, or a custom style), or a paint value is an expression that is not one value, that knob takes the `streetLight` look, `hsl(38, 6%, 90%)`, opacity 0.7, gradient on, and the plugin's own zoom range, 10–22. Every other standard style resolves colour, opacity and gradient from its own buildings.
- Landmark tiles exist at zoom 15 only, so keep `minZoom` near 15 (see Gotchas).

## Methods

```ts
import { getKnob, resetKnob, setKnob, setKnobs } from '@tomtom-org/maps-sdk/map';

landmarks.updateConfig({ color: '#c8b28a', opacity: 0.9 }); // set some, keep the others
landmarks.applyConfig({ opacity: 1 });                      // replace all: color follows the base map again
landmarks.resetConfig();                                    // every knob follows the base map
landmarks.getConfig();                                      // the knobs set only: {}

setKnob(landmarks, landmarks3DKnobCatalogue, 'verticalGradient', false); // validated; RangeError when refused
setKnobs(landmarks, landmarks3DKnobCatalogue, { color: '#1d3f8a', maxZoom: 20 });
getKnob(landmarks, landmarks3DKnobCatalogue, 'opacity');                 // value in force: the base map's when unset
resetKnob(landmarks, landmarks3DKnobCatalogue, 'color');

landmarks.setVisible(false);            // = updateConfig({ visible: false })
landmarks.isVisible();                  // boolean

landmarks.layer;                        // the underlying ModelsLayer (advanced use)
```

`landmarks3DKnobCatalogue` entries carry `id`, `kind`, `description`, `range` and, for `visible`, `default` — static data for a UI or an agent.

## How it works

- Adds a MapLibre **custom layer** (`ModelsLayer`, id `orbis-3d-landmarks`) that fetches the GLB tiles covering the viewport and renders them with Three.js, keeping lighting in sync with the map style light.
- **Frames on demand**: the layer draws when the map draws and requests a frame only when a tile arrives, so a still map stays idle. After writing a `landmarks.layer` field yourself (`diffuseColor`, `visible`), call `map.mapLibreMap.triggerRepaint()`.
- Added with `map.addCustomLayer(layer, { beforeLayerConfig: 'poi' })` (on top when the style lacks it), so POIs draw over the meshes and roads stay below. Module layers you place at `'poi'` go under the meshes too, even when added after `Landmarks3D`: place a label you want over a landmark at `'top'`.
- Filters basemap extrusions flagged `has_landmark` out of `3D - Building` (through `LayerFilterComposer`), so they don't clip through the high-detail meshes. It leaves the layer's visibility to `BaseMapModule`.
- The SDK puts the layer back after map style changes, and the plugin re-applies the filter and the look.
- **3D terrain**: with `TerrainModule` elevation on, each landmark is lowered onto the lowest terrain under its footprint every frame, so it follows terrain tiles as they load and exaggeration changes. Nothing to configure.

## Gotchas

- **Entitlement**: tiles load only with an API key entitled for Orbis 3D Landmarks (private preview); otherwise the map renders without landmarks, and the console warns per tile that the key needs that access, with where to request it. A `Buildings3D` then keeps the buildings the landmarks would replace, from the first refused tile on.
- **Pitch**: with a top-down camera the meshes look flat — pitch the camera.
- **Tile URL**: built automatically from `TomTomConfig` (`apiKey`, `commonBaseURL`); proxy mode (empty `apiKey`) omits the `key` param. `buildLandmarksTileURL()` is exported if you need the template directly.
- **`minZoom` far below 15**: landmark tiles exist at zoom 15 only, so each zoom level below it quadruples the tiles a view needs (16× at zoom 13), more on a pitched camera. With several maps on a page the browser runs out of connections (`ERR_INSUFFICIENT_RESOURCES`). Keep `minZoom` near 15.
- **Several maps**: one `new Landmarks3D(map)` per map, each loading its own view's tiles. Each map is a WebGL context and browsers cap them per page (16 in Chrome), so move the maps you have rather than creating more. Three.js logs `Multiple active KTX2 loaders`; harmless.
- **Framing a tall landmark**: aim at its mid-height with `centerClampedToGround: false` in the map's `mapLibre` options plus a camera `elevation` in metres. MapLibre's `flyTo`/`easeTo` keep the previous `elevation`, so move with `jumpTo({ center, elevation, … })`. Re-aim at the ground before the user zooms in: MapLibre picks tile detail from the distance to the aimed point, so zooming in on one 200 m up draws the streets in 1,000+ tiles and the map stalls (2–5 fps). In a capture-phase `pointerdown`/`wheel`/`keydown` listener on the map container (a jump during a gesture cancels it), `jumpTo` the same camera aimed at elevation 0: the centre moves `elevation × tan(pitch)` metres along the bearing, and the zoom drops by `log2((d + elevation / cos(pitch)) / d)`, `d` being the camera's distance to the old centre (`examples/cinematic-city-orbit/src/aimAtGround.ts`).
- **Peer deps**: `three` must be present in the app's dependency tree.
- **KTX2 transcoder**: landmark textures are KTX2, decoded by the Basis Universal transcoder, `basis_transcoder.js` and `basis_transcoder.wasm` in the plugin's `dist/`, fetched with the first landmark tile (no CDN request). The plugin references them as `new URL('./basis_transcoder.wasm', import.meta.url)`, so Vite and webpack 5 emit and hash them, and they load from the app's host. A bundler that doesn't emit `new URL(…, import.meta.url)` assets (Rollup or esbuild on their own) 404s them: copy the two files and set `transcoderPath`. The Vite 7 dev server's esbuild pre-bundler moves the plugin into `node_modules/.vite/deps/`, away from them (the `.wasm` request then gets `index.html`): upgrade to Vite 8, or add `'@tomtom-org/maps-sdk-plugin-landmarks-3d'` to the `optimizeDeps.exclude` that `map-setup.md` gives for the SDK. To serve them from another host, copy the two files there and pass `new Landmarks3D(map, { transcoderPath: 'https://assets.example.com/basis/' })`. A strict CSP needs `blob:` in `worker-src`, and the transcoder's host in `connect-src`: `'self'` by default, else the `transcoderPath` host.

## Buildings 3D

`Buildings3D` draws the **base map's buildings** in 3D with Three.js: procedural windows on the facades, a sun or moon casting real shadows on the buildings and the ground, glass mirroring the street and the sky and, on the dark street and mono presets, windows lit from inside. It extrudes the `buildings` source layer of the vector tiles the map already loaded and makes no requests of its own.

```ts
import { Buildings3D } from '@tomtom-org/maps-sdk-plugin-landmarks-3d';

const buildings = new Buildings3D(map, { preset: 'streetDark' }); // starting knobs optional; no await, draws once the map is ready
buildings.updateConfig({ facade: { pattern: 'glass' }, light: { direction: 260, altitude: 12 } });
```

- **Replaces the style's 3D buildings while visible**: it filters `3D - Building` out through `LayerFilterComposer`, so leave the `buildings3D` group as it is. `setVisible(false)` gives the style's own buildings their place back. The filter leaves the `buildings3D` group with nothing queryable, so a `buildings3D` scope on `BaseMapModule` never fires; the Three.js buildings are not interactive either (map-effects overlays behave the same way for hit-testing).
- Custom layer `tomtom-3d-buildings`, inserted before `3D - Building` (else before the style's first symbol layer, else on top), re-added after `setStyle`.
- While a `Landmarks3D` on the same map draws its landmarks (visible, in its zoom range), buildings flagged `has_landmark` are left out. Order of creation doesn't matter.
- **Its light is its own** `light.*` and `ambientLight.*`: the styling `view.light.*` knobs light `3D - Building`, which it filters out, so they light nothing while it shows.
- **Draws the landmarks in its own scene** while visible (`ModelsLayer` then draws nothing): one sun and sky, one shadow map, so landmarks and buildings cast shadows on each other and `shadows.*` covers both, and translucent ones blend together. Landmarks take its `walls.color`, `opacity` and `minZoom` for their unset knobs, and show the light and shade of their own authored texture as facade detail, scaled by `facade.intensity` (their `texture` knob unset; `color` draws the texture's own colours instead, `mask` plain walls). Their walls mirror a little of the street and the sky, darker texels (glass, openings) the most and roofs barely, scaled by `reflections.intensity`. No procedural windows, lit windows or wall gradient on landmarks: their `verticalGradient` has no effect, and unset, `getKnob` reports `false`; their `maxZoom` unset is 22. A landmark knob set still wins; `buildings.setVisible(false)` hands them back to the style.
- **Shadows reach 5 km**: the shadow map covers the ground in view up to 5 km from the map centre, and the streets' shadows fade out before it. Past it, in a steeply tilted view, buildings stand unshadowed.
- Draws at sea level: on 3D terrain, hills cover the lower floors of buildings on high ground.
- Repaints while tiles are being extruded (8 ms of each frame at most, a dense tile over several), then a still map goes idle.

## Buildings 3D knobs

Each id is a path into `Buildings3DConfig` (`'light.altitude'` → `{ light: { altitude } }`). Every knob but `visible` and `preset` **takes the preset's value while unset**; `getKnob` reports it.

| Knob | Kind | Range / options | Unset |
|---|---|---|---|
| `visible` | toggle | — | `true` |
| `preset` | enum | `buildingsPresets`: `auto` or a standard style ID | `auto`: the map's standard style |
| `opacity` | number | 0–1 | `1` |
| `minZoom` | number | 13–22 | `15` |
| `facade.pattern` | enum | `facadePatterns`: `mixed` (by height: punched windows, office bands from ~6 storeys, glass towers), `residential`, `office`, `glass`, `plain` | `mixed` |
| `facade.intensity` | number | 0–1 | preset |
| `facade.floorHeightMeters` | number | 2.5–6 (hard min) | `3.4`; the ground floor is a third taller |
| `walls.color` | color | CSS colour | the style's `3D - Building` colour per `group` (education, transport, leisure, healthcare, shopping, other), following map colours; `getKnob` reports the `other` one |
| `roofs.color` | color | CSS colour | the walls, a shade darker; `getKnob` reports the walls' colour, not the shade |
| `windows.color` | color | CSS colour | preset |
| `reflections.intensity` | number | 0–1: how much the window glass mirrors the facades across the street and the sky (the `ambientLight.color`), in place of its own colour, and catches a glint of the light. The mirrored facades, with their own windows, slide across the glass as the camera moves and take the `light.*` and `ambientLight.*` of the scene, lit windows included at night, the mirrored sky glows towards the light, and a pane in shadow loses the sun's glint; glass curtain walls reflect the most | `0.7` |
| `litWindows.color` | color | CSS colour | preset |
| `litWindows.fraction` | number | 0–1 | `0` on light presets and `streetSatellite`, ~0.2–0.3 on the dark street and mono presets |
| `litWindows.intensity` | number | 0–1 | preset |
| `light.direction` | number | 0–359 ° clockwise from north | preset; shadows fall the opposite way |
| `light.altitude` | number | 5–90 ° above the horizon | preset; lower = longer shadows |
| `light.color` | color | CSS colour | preset: sun on light presets and `streetSatellite`, moon on the dark street and mono presets |
| `light.intensity` | number | 0–1 | preset |
| `ambientLight.color` | color | CSS colour | preset; also tints the glass reflections |
| `ambientLight.intensity` | number | 0–1 | preset |
| `shadows.visible` | toggle | — | preset (`true`) |
| `shadows.intensity` | number | 0–1 | preset |
| `roadLabels.occluded` | toggle | — | preset (`false`); `true` moves the road-label layers under the buildings' layer, so a building drawn over a label hides it (no cost per frame). Moved under, they give way to the labels above them in collisions |
| `pois.occluded` | toggle | — | preset (`false`); the same for the style's POI layers. A hidden POI still takes its collision space |

- Same methods as `Landmarks3D`: `updateConfig` (one level deep: a part like `light` replaces that part), `applyConfig`, `resetConfig`, `getConfig`, `setVisible`, `isVisible`, `layer`, and the SDK's `getKnob`/`setKnob`/`setKnobs`/`resetKnob` with `buildings3DKnobCatalogue`.
- `streetSatellite` has no `3D - Building` layer, so its preset sets walls and roofs of its own.
- For a night glow, pair `streetDark`, `streetDarkDriving` or `monoDark` with the map-effects plugin's bloom (`streetSatellite` keeps a day look despite the dark map theme).
