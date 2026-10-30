# Landmarks 3D Plugin Reference

Renders TomTom Orbis **3D Landmarks** — high-detail building meshes streamed as GLB tiles — on a `TomTomMap`, drawn with Three.js through a MapLibre custom layer and shaded to blend with the basemap's 3D buildings. The package also ships `Buildings3D`, the base map's buildings in 3D, and `GLSurfaces`, textured water, ground and roads with 3D trees ([gl-surfaces.md](gl-surfaces.md)), all three drawn by one Three.js renderer under one sun.

Package: `@tomtom-org/maps-sdk-plugin-landmarks-3d`. Each part carries its own preview label: `Landmarks3D` here, `Buildings3D` in its section below, `GLSurfaces` in [gl-surfaces.md](gl-surfaces.md).

> [Private preview](https://docs.tomtom.com/legal/private-preview) — `Landmarks3D`: its tiles need an API key with Orbis 3D Landmarks entitlements.

## Imports

```ts
import {
    Landmarks3D,
    type Landmarks3DOptions,
    type Landmarks3DConfig,
    // advanced: the custom layer and its tile URL, for building the layer yourself
    buildLandmarksTileURL,
    ModelsLayer,
    ModelsSource,
    type ModelsLayerSpecification,
    type ModelsSourceSpecification,
    // the base map's buildings in 3D, with facades, lights and shadows
    Buildings3D,
    type Buildings3DConfig,
    type BuildingsLayer,
    // what buildings.events and landmarks.events hand a handler
    type BuildingHit,
    // textured surfaces and 3D trees: the full list is in gl-surfaces.md
    GLSurfaces,
    type GLSurfacesConfig,
} from '@tomtom-org/maps-sdk-plugin-landmarks-3d';
// the knob catalogues and their value lists: static data, importing nothing from three.js
import {
    landmarks3DKnobCatalogue,
    landmarks3DKnobIds,
    type Landmarks3DKnob,
    type Landmarks3DKnobId,
    type Landmarks3DKnobValueOf,
    landmarkTextureUses,
    type LandmarkTextureUse,
    buildings3DKnobCatalogue,
    buildings3DKnobIds,
    type Buildings3DKnob,
    type Buildings3DKnobId,
    type Buildings3DKnobValueOf,
    buildingsPresets,
    type BuildingsPreset,
    facadePatterns,
    type FacadePattern,
    // walls.palette, roofs.palette and the landmarks' palette are arrays of your own colours
    paletteModes,
    type PaletteMode,
    paletteMapColors,
    // the textured surfaces' catalogue: its value lists are in gl-surfaces.md
    glSurfacesKnobCatalogue,
} from '@tomtom-org/maps-sdk-plugin-landmarks-3d/knobs';
```

- **`/knobs` is the only path to the catalogues**, and it imports nothing from three.js. An app can read them at startup, to describe the knobs to an LLM tool, check values or build a settings panel, and still `import()` the plugin itself the first time it draws 3D.

Guides: [Landmarks 3D plugin](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d.md), with the installation and the light the parts share, [3D landmarks](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d-landmarks.md), [3D buildings](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d-buildings.md) and [GL surfaces](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d-gl-surfaces.md).

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

The look is a set of knobs, each id its path in `Landmarks3DConfig` (`hover.color` is `{ hover: { color } }`). `color`, `opacity`, `verticalGradient`, `minZoom` and `maxZoom` **follow the base map's `3D - Building` layer while unset**, each on its own; the Unset column gives the rest:

| Knob | Kind | Range | Unset |
|---|---|---|---|
| `visible` | toggle | — | `true` |
| `color` | color | CSS colour | the 3D buildings' `fill-extrusion-color` (a `match` uses its default operand) |
| `palette` | colors | CSS colours and/or map colours by knob id (`paletteMapColors`: `colors.artificial`, `colors.accent`, …); each landmark takes one, by a hash of its position | none; the walls' `walls.palette` while a `Buildings3D` draws **and `color` is unset** |
| `paletteMode` | enum | `paletteModes`: `pick` (one colour), `blend` (a mix of two neighbouring ones anywhere along the palette) | `pick`; the walls' while a `Buildings3D` draws |
| `paletteIntensity` | number | 0 (`color`) – 1 (the palette colour) | `1`; the walls' while a `Buildings3D` draws |
| `variation` | number | 0–1: each landmark lighter or darker and a little warmer or cooler | `0`; the walls' `walls.variation` while a `Buildings3D` draws |
| `hover.color`, `click.color` | color | CSS colour the hovered / clicked landmark turns towards (see Interaction) | `map.mapColors.accent`, else `#2f7df6`; the buildings' `hover.color` / `click.color` while a `Buildings3D` draws |
| `hover.intensity`, `click.intensity` | number | 0 (no change) – 1 (the full colour) | `0.35` / `0.7`; the buildings' while a `Buildings3D` draws |
| `texture` | enum | `landmarkTextureUses`: `mask` (the texture only carves the silhouette; shaded in `color`), `detail` (its light and shade over `color`), `color` (its own colours in place of `color`) | `color` on `streetSatellite`; else `mask`, or `detail` while a `Buildings3D` draws |
| `opacity` | number | 0–1 | the 3D buildings' `fill-extrusion-opacity` |
| `verticalGradient` | toggle | — | the 3D buildings' `fill-extrusion-vertical-gradient` |
| `minZoom` | number | 0–22 | the 3D buildings' `minzoom` |
| `maxZoom` | number | 0–22 | the 3D buildings' `maxzoom`; landmarks stay drawn up to the next whole zoom |

- **Follows the style live**: an unset knob is re-read on every MapLibre `styledata`, so it follows `setStyle`, the map colours that recolour the 3D buildings (`styling.setMapColors(...)`, a `colors.artificial`/`colors.land` knob, a map-theme theme) and a raw `setPaintProperty('3D - Building', …)`. It repaints only when the look changed. A knob set always wins.
- **With a visible `Buildings3D` on the map** (it hides `3D - Building`): unset `color`, `opacity` and `minZoom` follow its resolved `walls.color`, `opacity` and `minZoom` instead, unset `paletteMode`, `paletteIntensity` and `variation` its `walls.*` ones, and unset `palette` its `walls.palette` while `color` is unset too, unset `texture` is `detail` (`color` on `streetSatellite`), and the landmarks are drawn in its scene, under its sun and in its shadows (see Buildings 3D). Hidden again, they follow `3D - Building`.
- **The landmarks' own colours**: the unset default on `streetSatellite`, whose imagery a paint sits badly in (also under a `Buildings3D`); elsewhere `updateConfig({ texture: 'color' })`. Every landmark mesh carries a colour texture; `color` samples it inside the same materials, so the style light's colour and intensity (or a `Buildings3D`'s sun, sky and shadows), `opacity` and `verticalGradient` keep applying. The textures carry no baked sun, so they are shaded once. Don't override `layer.getMaterial()` to return `mesh.userData.originalMaterial`: it isn't supported, the authored material skips `opacity`, `verticalGradient` and the style light's colour (its Three.js lights stay white), and a `Buildings3D` never calls `getMaterial()`.
- **Fallback**: where the style has no `3D - Building` layer (`streetSatellite`, or a custom style), or a paint value is an expression that is not one value (a colour is read as a single one or the `match` on `group`, inside the hover and click states the map adds; a `coalesce` of your own is not), that knob takes the `streetLight` look, `hsl(38, 6%, 90%)`, opacity 0.7, gradient on, and the plugin's own zoom range, 10–22. Every other standard style resolves colour, opacity and gradient from its own buildings. To colour single base-map buildings and keep the landmarks following, use `BaseMapModule.setBuildingColors`, not a `feature-state` paint of your own.
- Landmark tiles exist at zoom 15 only, so a `minZoom` below 15 draws from 15 (see Gotchas).

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

`landmarks3DKnobCatalogue` entries carry `id`, `kind`, `description`, `range` and, for `visible`, `default` — static data for a UI or an agent, from `/knobs` (see Imports).

## How it works

- Adds a MapLibre **custom layer** (`ModelsLayer`, id `orbis-3d-landmarks`) that fetches the GLB tiles covering the viewport and renders them with Three.js, keeping lighting in sync with the map style light.
- **Frames on demand**: the layer draws when the map draws and requests a frame only when a tile arrives, so a still map stays idle. After writing a `landmarks.layer` field yourself (`diffuseColor`, `visible`), call `map.mapLibreMap.triggerRepaint()`.
- Added with `map.addCustomLayer(layer, { beforeLayerConfig: 'poi' })` (on top when the style lacks it), so POIs draw over the meshes and roads stay below. Module layers you place at `'poi'` go under the meshes too, even when added after `Landmarks3D`: place a label you want over a landmark at `'top'`.
- Filters basemap extrusions flagged `has_landmark` out of `3D - Building` (through `LayerFilterComposer`), so they don't clip through the high-detail meshes. It leaves the layer's visibility to `BaseMapModule`.
- The SDK puts the layer back after map style changes, and the plugin re-applies the filter and the look.
- **3D terrain**: with `TerrainModule` elevation on, each landmark is lowered onto the lowest terrain under its footprint, and again whenever terrain tiles load or the exaggeration changes. Nothing to configure.

## Gotchas

- **Entitlement**: tiles load only with an API key entitled for Orbis 3D Landmarks (private preview); otherwise the map renders without landmarks, and `map.addErrorHandler` gets one `TomTomMapError` (`sourceId` = `landmarks.layer.id`, match on that rather than the literal, `code: 'INSUFFICIENT_PERMISSIONS'`, `apiErrorCode: 'Forbidden'`) whose `.privatePreviewAccess` is `{ product: 'Orbis 3D Landmarks', requestAccessURL }`, also named in its message — the same fields a Private Preview service call's `SDKServiceError` carries (`core-types.md` § SDK errors). A `401`, or a `403` with `apiErrorCode: 'InvalidReferer'` (no `privatePreviewAccess`), is reported once the same way. After any of them the plugin requests no more tiles, and a `Buildings3D` keeps the buildings the landmarks would replace. Any other failed tile (`5xx`, `429`, no connection, an unreadable GLB as `INTERNAL`) reaches the handlers by status like the map's own tiles (`map-setup.md` § Map errors); one with `.canRetry` is fetched again on a move over it after a backoff (1 s, doubled per failure, up to 60 s) and reported once until it loads, as is one the Basis transcoder failed to load for (`INTERNAL`, no `.canRetry`); with no handler registered, the map `console.error`s it.
- **Pitch**: with a top-down camera the meshes look flat — pitch the camera.
- **Tile URL**: built automatically from `TomTomConfig` (`apiKey`, `commonBaseURL`); proxy mode (empty `apiKey`) omits the `key` param. `buildLandmarksTileURL()` is exported if you need the template directly.
- **`minZoom` below 15**: landmark tiles exist at zoom 15 only, and the landmarks draw and load tiles from MapLibre's tile zoom 15 up, whatever a lower `minZoom` says.
- **Several maps**: one `new Landmarks3D(map)` per map, each loading its own view's tiles. Each map is a WebGL context and browsers cap them per page (16 in Chrome), so move the maps you have rather than creating more. Three.js logs `Multiple active KTX2 loaders`; harmless.
- **Framing a tall landmark**: aim at its mid-height with `centerClampedToGround: false` in the map's `mapLibre` options plus a camera `elevation` in metres. MapLibre's `flyTo`/`easeTo` keep the previous `elevation`, so move with `jumpTo({ center, elevation, … })`. Re-aim at the ground before the user zooms in: MapLibre picks tile detail from the distance to the aimed point, so zooming in on one 200 m up draws the streets in 1,000+ tiles and the map stalls (2–5 fps). In a capture-phase `pointerdown`/`wheel`/`keydown` listener on the map container (a jump during a gesture cancels it), `jumpTo` the same camera aimed at elevation 0: the centre moves `elevation × tan(pitch)` metres along the bearing, and the zoom drops by `log2((d + elevation / cos(pitch)) / d)`, `d` being the camera's distance to the old centre (`examples/cinematic-city-orbit/src/aimAtGround.ts`).
- **Peer deps**: `three` must be present in the app's dependency tree.
- **KTX2 transcoder**: landmark textures are KTX2, decoded by the Basis Universal transcoder, `basis_transcoder.js` and `basis_transcoder.wasm` in the plugin's `dist/`, fetched with the first landmark tile (no CDN request). The plugin references them as `new URL('./basis_transcoder.wasm', import.meta.url)`, so Vite and webpack 5 emit and hash them, and they load from the app's host. A bundler that doesn't emit `new URL(…, import.meta.url)` assets (Rollup or esbuild on their own) 404s them: copy the two files and set `transcoderPath`. The Vite 7 dev server's esbuild pre-bundler moves the plugin into `node_modules/.vite/deps/`, away from them (the `.wasm` request then gets `index.html`): upgrade to Vite 8, or add `'@tomtom-org/maps-sdk-plugin-landmarks-3d'` to the `optimizeDeps.exclude` that `map-setup.md` gives for the SDK. To serve them from another host, copy the two files there and pass `new Landmarks3D(map, { transcoderPath: 'https://assets.example.com/basis/' })`. A strict CSP needs `blob:` in `worker-src`, and the transcoder's host in `connect-src`: `'self'` by default, else the `transcoderPath` host.

## Buildings 3D

> [Public preview](https://docs.tomtom.com/legal/public-preview) — `Buildings3D` works with any API key.

`Buildings3D` draws the **base map's buildings** in 3D with Three.js: procedural windows on the facades, a sun or moon casting real shadows on the buildings and the ground, glass mirroring the street and the sky and, on the dark street and mono presets, windows lit from inside. It extrudes the `buildings` source layer of the vector tiles the map already loaded and makes no requests of its own.

```ts
import { Buildings3D } from '@tomtom-org/maps-sdk-plugin-landmarks-3d';

const buildings = new Buildings3D(map, { preset: 'streetDark' }); // starting knobs optional; no await, draws once the map is ready
buildings.updateConfig({ facade: { pattern: 'glass' }, light: { direction: 260, altitude: 12 } });
```

- **Replaces the style's 3D buildings while visible**: it filters `3D - Building` out through `LayerFilterComposer`, so leave the `buildings3D` group as it is. `setVisible(false)` gives the style's own buildings their place back. The filter leaves the `buildings3D` group with nothing queryable, so a `buildings3D` scope on `BaseMapModule` never fires; listen to `buildings.events` instead (see Interaction).
- Custom layer `tomtom-3d-buildings`, inserted before `3D - Building`, else right above `mapStyleLayerIDs.lowestLabel` (`streetSatellite`), else before the style's first symbol layer, else on top; re-added after `setStyle`.
- While a `Landmarks3D` on the same map draws its landmarks (visible, in its zoom range), buildings flagged `has_landmark` are left out. Order of creation doesn't matter.
- **Its sun follows the map's light** (`getMapLight(map)`, set by the styling `view.light.*` knobs): `light.direction` and `light.altitude` each follow it while unset, and take the preset's while the map has none (the standard styles place none). `GLSurfaces` ([gl-surfaces.md](gl-surfaces.md)) follows the same light, so set it once with `view.light.*`, and its 3D trees receive these buildings' shadows. The light's colour and strength stay its own `light.color`, `light.intensity` and `ambientLight.*`.
- **Draws the landmarks in its own scene** while visible (`ModelsLayer` then draws nothing): one sun and sky, one shadow map, so landmarks and buildings cast shadows on each other and `shadows.*` covers both, and translucent ones blend together. Landmarks take its `walls.color`, palette knobs, `walls.variation`, `opacity` and `minZoom` for their unset knobs, and show the light and shade of their own authored texture as facade detail, scaled by `facade.intensity` (their `texture` knob unset, except on `streetSatellite`, where they take `color`; `color` draws the texture's own colours instead, `mask` plain walls). Their walls mirror a little of the street and the sky, darker texels (glass, openings) the most and roofs barely, scaled by `reflections.intensity`. No procedural windows, lit windows or wall gradient on landmarks: their `verticalGradient` has no effect, and unset, `getKnob` reports `false`; their `maxZoom` unset is 22. A landmark knob set still wins; `buildings.setVisible(false)` hands them back to the style.
- **Shadows reach 5 km**: the shadow map covers the ground in view up to 5 km from the map centre, and the streets' shadows fade out before it. Past it, in a steeply tilted view, buildings stand unshadowed.
- **3D terrain**: each building stands on the lowest ground at the corners of its outline's bounds, sunk half a metre into the slope, and stands again as finer terrain tiles load or the exaggeration changes. The ground's shadows lie on a plane, so on terrain only the buildings take them.
- Repaints while tiles are being extruded (8 ms of each frame at most, a dense tile over several), then a still map goes idle.

## Buildings 3D knobs

Each id is a path into `Buildings3DConfig` (`'light.altitude'` → `{ light: { altitude } }`). Every knob but `visible`, `preset`, `light.direction` and `light.altitude` **takes the preset's value while unset**, except `hover.color` and `click.color`, which take the map's accent, else blue. `light.direction` and `light.altitude` take the map's light first, then the preset. `getKnob` reports the value in force; a map light's direction is drawn exact as the map turns and reported rounded to whole degrees, so it round-trips through `setKnob`.

| Knob | Kind | Range / options | Unset |
|---|---|---|---|
| `visible` | toggle | — | `true` |
| `preset` | enum | `buildingsPresets`: `auto` or a standard style ID | `auto`: the map's standard style |
| `opacity` | number | 0–1 | `1` |
| `minZoom` | number | 13–22 | `15` |
| `facade.pattern` | enum | `facadePatterns`: `mixed` (by height: punched windows, office bands from ~5 storeys (18 m) with some glass, glass towers), `residential`, `office`, `glass`, `plain` | `mixed` |
| `facade.intensity` | number | 0–1 | preset |
| `facade.floorHeightMeters` | number | 2.5–6 (hard min) | `3.4`; the ground floor is a third taller |
| `walls.color` | color | CSS colour | the style's `3D - Building` colour per `group` (education, transport, leisure, healthcare, shopping, other), following map colours; `getKnob` reports the `other` one |
| `walls.palette` | colors | CSS colours and/or map colours by knob id (`paletteMapColors`); each building takes one, over `walls.color`. The SDK ships no named palettes: pass your own array. The first 8 colours draw | none (`[]`) |
| `walls.paletteMode` | enum | `paletteModes`: `pick`, `blend` | `pick` |
| `walls.paletteIntensity` | number | 0 (`walls.color`) – 1 (the palette colour) | `1` |
| `walls.variation` | number | 0–1: each building lighter or darker and a little warmer or cooler, with or without a palette | `0.12` |
| `roofs.color` | color | CSS colour | the walls, a shade darker (palette colour and variation included); `getKnob` reports the walls' colour, not the shade; `streetSatellite` sets its own |
| `roofs.palette`, `roofs.paletteMode`, `roofs.paletteIntensity` | colors, enum, number | as the walls' ones; each roof takes a colour of the array, over `roofs.color` (else the walls' colour) | none, `pick`, `1`: roofs follow the walls, wall palette included, while `roofs.color` and `roofs.palette` are both unset |
| `hover.color`, `click.color` | color | CSS colour the hovered / clicked building turns towards (see Interaction) | `map.mapColors.accent`, else `#2f7df6` |
| `hover.intensity`, `click.intensity` | number | 0 (no change) – 1 (the full colour) | `0.35` / `0.7` |
| `windows.color` | color | CSS colour | preset |
| `reflections.intensity` | number | 0–1: how much the window glass mirrors the facades across the street and the sky (the `ambientLight.color`), in place of its own colour, and catches a glint of the light. The mirrored facades, with their own windows, slide across the glass as the camera moves and take the `light.*` and `ambientLight.*` of the scene, lit windows included at night, the mirrored sky glows towards the light, and a pane in shadow loses the sun's glint; glass curtain walls reflect the most | `0.7` |
| `litWindows.color` | color | CSS colour | preset |
| `litWindows.fraction` | number | 0–1 | `0` on light presets and `streetSatellite`, ~0.2–0.3 on the dark street and mono presets |
| `litWindows.intensity` | number | 0–1 | preset |
| `light.direction` | number | 0–359 ° clockwise from north | the map's light, else preset; shadows fall the opposite way |
| `light.altitude` | number | 5–90 ° above the horizon | the map's light, else preset; lower = longer shadows |
| `light.color` | color | CSS colour | preset: sun on light presets and `streetSatellite`, moon on the dark street and mono presets |
| `light.intensity` | number | 0–1 | preset |
| `ambientLight.color` | color | CSS colour | preset; also tints the glass reflections |
| `ambientLight.intensity` | number | 0–1 | preset |
| `shadows.visible` | toggle | — | preset (`true`) |
| `shadows.intensity` | number | 0–1 | preset |
| `roadLabels.occluded` | toggle | — | preset (`false`); `true` moves the road-label layers under the buildings' layer, so a building drawn over a label hides it (no cost per frame). Moved under, they give way to the labels above them in collisions |
| `pois.occluded` | toggle | — | preset (`false`); the same for the style's POI layers. A hidden POI still takes its collision space |

- Same methods as `Landmarks3D`: `updateConfig` (one level deep: a part like `light` replaces that part), `applyConfig`, `resetConfig`, `getConfig`, `setVisible`, `isVisible`, `layer`, and the SDK's `getKnob`/`setKnob`/`setKnobs`/`resetKnob` with `buildings3DKnobCatalogue`.
- `streetSatellite` has no `3D - Building` layer, so its preset sets walls and roofs of its own, and the buildings' layer goes right above `mapStyleLayerIDs.lowestLabel`, where the street styles draw theirs: over the roads and bridges, under the labels.
- **Palettes naming map colours** (`colors.<name>`, as in `['colors.artificial', 'colors.land']`) read `map.mapColors`, so they follow a map-theme theme or `setMapColors`. The plugin calls `StylingFoundationsModule.get(map)` itself the first time a palette names one, since the map publishes its colours only once that module exists. An unset map colour (`colors.accent` with no theme) is left out of the palette. Tint a city with its theme at a low `paletteIntensity` (0.2–0.3); 1 paints the buildings the map's park and water colours.
  ```ts
  buildings.updateConfig({ walls: { palette: ['#b5654a', '#c47f5e', '#d2a98c'], variation: 0.3 } });
  buildings.updateConfig({ roofs: { palette: ['#5b6770', '#8c5a44'] } }); // roofs of their own
  buildings.updateConfig({ walls: { palette: ['#efe4cf', 'colors.accent'], paletteMode: 'blend', paletteIntensity: 0.4 } });
  ```
- For a night glow, pair `streetDark`, `streetDarkDriving` or `monoDark` with the map-effects plugin's bloom (`streetSatellite` keeps a day look despite the dark map theme).

## Interaction

`buildings.events` and `landmarks.events` are the SDK's custom-layer user events (`map.addCustomLayer` with a `hitTest`), the same `on(eventType, handler)` as a module's. The handler's first argument is a `BuildingHit`: `{ id, properties }`.

```ts
buildings.events.on('click', (building) => console.log(building.id, building.properties.height)); // feature id + tile properties
landmarks.events.on('hover', (landmark) => console.log(landmark.id, landmark.properties.position)); // [lng, lat]

buildings.setBuildingColors({ 6183703601: '#e4572e' }); // by id; replaces the previous set, {} clears
landmarks.setLandmarkColors({ [landmarkId]: '#1faa59' });
buildings.getBuildingColors();                            // { 6183703601: '#e4572e' }
landmarks.setLandmarkColors({ ...landmarks.getLandmarkColors(), [otherId]: '#29335c' }); // add one: spread the set
buildings.updateConfig({ hover: { color: '#ffb400' }, click: { color: '#e4572e', intensity: 1 } });
```

- **States need a handler**: any handler on a layer turns the hovered object towards `hover.color`; the clicked one turns towards `click.color` only with a `click` handler, until the next click lands elsewhere. The SDK hands the states to the layer, like a module's `eventState`; there's no `putEventState` to call.
- **One pick for both** while a `Buildings3D` draws the landmarks: the nearest building or landmark along the pointer's ray wins, so a building in front of a landmark takes the pointer. Without `Buildings3D`, the landmarks' layer sits above `3D - Building`, so a landmark wins wherever it shows.
- **Ids**: a building's is its vector-tile feature id (stable across tiles and zoom levels); a landmark's is a number taken from its position, stable across sessions. Both can be coloured before they load. Building `properties` are the tile's (`height`, `group`…), and not every building has a `height`.
- **By place**: `Buildings3D` has no position lookup; `(await BaseMapModule.get(map)).getBuildingIdAt(position)` returns the same id `setBuildingColors` takes (after the map is idle with the place in view). Example: `examples/buildings-3d-interaction`.
- **Buildings in parts**: the tiles split a building of several heights into `part` features, each with its own id, under an undrawn `has_part` outline. The plugin draws, colours and lights up the parts as one building, reporting the outline's id and properties; `BaseMapModule` reports the hovered part's id and takes any part's id as the whole building's.
- **Own colours** replace the wall colour, palette and variation (roof included; windows still show). A coloured landmark under `texture: 'color'` draws as under `detail`. Hover and click colours mix over own colours.
- Example: `examples/buildings-3d-interaction`.
- **Without the plugin**, the style's own `3D - Building` layer takes the same hover, click and colour-by-id looks through `BaseMapModule` (`buildings3D.hover` / `buildings3D.click`, `setBuildingColors`): `map-setup.md` § BaseMapModule. A showing `Buildings3D` filters the buildings out of that layer, so set them on the plugin then.
