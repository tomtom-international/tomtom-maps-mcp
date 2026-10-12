# Map Setup Reference

## Imports

```ts
import { bboxFromGeoJSON, TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, BaseMapModule, TerrainModule, PlacesModule, POIsModule } from '@tomtom-org/maps-sdk/map';
import { setKnob, setKnobs, baseMapKnobCatalogue, placesKnobCatalogue, terrainKnobCatalogue } from '@tomtom-org/maps-sdk/map';
import { calculatePaddedBBox, calculatePaddedCenter, calculateFittingBBox } from '@tomtom-org/maps-sdk/map';
import { discoverPlaces } from '@tomtom-org/maps-sdk/services';
```

---

## Full-screen map HTML + CSS boilerplate

The map container **and its parent elements** (`html`, `body`) all need explicit height — without this the map renders with zero height, which is the most common setup issue:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no">
    <style>
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
        #map { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    </style>
</head>
<body>
    <div id="map"></div>
    <script type="module" src="./index.ts"></script>
</body>
</html>
```

---

## The MapLibre web worker — Vite, webpack, CDN

MapLibre GL v6 runs its web worker from a separate module (`dist/maplibre-gl-worker.mjs`) that it locates beside its own file at runtime. Neither Vite's dev pre-bundler nor `vite build` emits that file, so on its own the map stays blank and the console logs `Worker failed to load. Check that the worker URL is correct.`

**`TomTomMap` covers Vite 8 by default, and `vite build` on Vite 7 — no `vite.config.ts` change, no `optimizeDeps.exclude`, no `setWorkerUrl` call.** The SDK hands your bundler a worker entry that imports your own `maplibre-gl` worker; Vite builds it into your app, and `TomTomMap` registers its URL with MapLibre before creating the map. The worker is served from your app's origin (no third-party request) and always matches your MapLibre version. After `vite build`, `dist/assets` holds a `maplibre-gl-worker-*.js`.

**The Vite 7 dev server needs one config change.** Its esbuild pre-bundler moves the SDK into `node_modules/.vite/deps/`, where the worker entry beside it doesn't exist, so the worker 404s. Upgrade to Vite 8, whose pre-bundler keeps the reference, or keep the SDK out of pre-bundling:

```ts
// vite.config.ts, Vite 7
export default defineConfig({
    optimizeDeps: { exclude: ['@tomtom-org/maps-sdk'], include: ['@turf/turf', 'culori/fn', 'lodash-es', 'zod'] },
});
```

`include` lists the SDK's peer dependencies, which Vite then pre-bundles on their own; without it, their CommonJS dependencies fail to import.

`TomTomMap` leaves MapLibre's own worker lookup in place:

- when the app already called MapLibre's `setWorkerUrl` before creating the map — its URL is kept;
- under **webpack**'s default classic workers — set up the worker as MapLibre's docs describe, with `setWorkerUrl`. With ES module output (`output.module: true`, `experiments.outputModule: true`) webpack builds a module worker, which `TomTomMap` registers as it does Vite's;
- under **Rollup**, **Rolldown** or **esbuild**, which build no worker from `new Worker(new URL(...))` — set it up with `setWorkerUrl` the same way;
- under **Next.js** with Turbopack, which emits neither the worker nor `maplibre-gl-shared.mjs` beside it. Copy both from `maplibre-gl/dist/` into one directory under `public/`, and call `setWorkerUrl` with the worker's public path before `new TomTomMap`. `registerMapLibreWorker: false` leaves the same failing lookup;
- when MapLibre loads unbundled from a CDN or an import map — MapLibre finds the worker beside its CDN file;
- with `registerMapLibreWorker: false`:

```ts
const map = new TomTomMap({ registerMapLibreWorker: false, mapLibre: { container: 'map' } });
```

To register a Vite-built worker yourself instead, which `TomTomMap` then keeps:

```ts
// vite.config.ts
export default defineConfig({ optimizeDeps: { exclude: ['maplibre-gl'] }, worker: { format: 'es' } });

// main.ts, before new TomTomMap(...)
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
```

`?worker&url` bundles the worker with its shared chunks; a plain `?url` copies the file alone, without the chunks it imports.

When serving MapLibre from a CDN, point at the published `dist/maplibre-gl.mjs` (e.g. jsDelivr, which mirrors the tarball as-is), **not** a re-bundling CDN such as esm.sh — it serves the entry from a rewritten path where the worker sibling doesn't exist, so the worker 404s and the map paints a blank background.

The MapLibre CSS, unlike the worker, is a copy bundled at the SDK's build-time MapLibre version, applied only when the page lacks it. After upgrading `maplibre-gl` past the SDK's version, `import 'maplibre-gl/dist/maplibre-gl.css'` to use the installed version's CSS.

---

## Map initialization

```ts
import './style.css';

const map = new TomTomMap({
    style: 'streetLight',   // see styles below
    language: 'en-GB',        // affects map labels and traffic incident descriptions
    geopoliticalView: 'IN',   // geopolitical view of disputed borders and names; defaults to the global one
    mapLibre: {
        container: 'map',     // HTML element id — must have CSS height set
        center: [4.9, 52.4],  // [longitude, latitude]
        zoom: 12,
    },
});

map.setStyle('monoDark');    // switch style dynamically — preserves all module state
map.setLanguage('fr-FR');    // change map label and traffic incident description language dynamically
map.setGeopoliticalView('PK'); // redraw disputed borders and names; services keep the global view (see services-config.md)
map.getBBox();               // → [west, south, east, north]
```

**Styles:** `streetLight` (default), `streetDark`, `streetLightDriving`, `streetDarkDriving`, `monoLight`, `monoDark`, `streetSatellite`

`mapLibre` (`MapLibreOptions`) takes MapLibre's map options except `style`, `attributionControl` and `transformRequest`, which the SDK sets itself; route TomTom requests through your own proxy with `commonBaseURL` instead (`services-config.md`).

When offering style switching, prefer a `<select>` dropdown with all 7 styles over a simple toggle — it showcases the full range and gives users real control; build it from `standardStyleIDs` (`map-styles.md` § Style switcher UI). For event handlers like background clicks, provide visible feedback (e.g. a toast notification with coordinates) rather than just `console.log`.

### Init from a bounding box instead of center/zoom

```ts
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';

const map = new TomTomMap({
    mapLibre: {
        container: 'map',
        bounds: bboxFromGeoJSON(places),          // [west, south, east, north]
        fitBoundsOptions: { padding: 100 },
    },
});
```

### Non-interactive map (e.g. thumbnail / embed)

```ts
const map = new TomTomMap({
    mapLibre: {
        container: 'map',
        bounds: geometry.bbox,
        interactive: false,       // disables pan/zoom/click
    },
});
```

Style parts (`style: { type: 'standard', include: [...] }`) and what adding one back later costs — its module's `get()` reloads the style, running the style change handlers: `map-styles.md` § Setting a style.

### Map errors

Map failures are `TomTomMapError`s: `.code` from the same `SDKErrorCode` set services use, `.canRetry` (`true` for `RATE_LIMITED`, `LIVE_SERVICE_NOT_AVAILABLE`, `NETWORK_NOT_AVAILABLE`), `.sdkVersion`, plus `.status` (HTTP) and `.sourceId` (the source whose tiles failed) when known.

| When | Arrives as | `code` |
|---|---|---|
| no WebGL2 | the constructor throws | `WEBGL_UNSUPPORTED` |
| `commonBaseURL` neither `https:` nor loopback `http:` | the constructor throws | `INSECURE_BASE_URL` |
| style fails to load | error handlers + a `setStyle` switch rejects | the status's (`INVALID_CREDENTIALS` = `401`, `INSUFFICIENT_PERMISSIONS` = `403`, `RATE_LIMITED`, …), `NETWORK_NOT_AVAILABLE` with no response, else `STYLE_LOAD_FAILED` |
| tile / sprite / glyph fails | error handlers, `.sourceId` set | the status's, `NETWORK_NOT_AVAILABLE` with no response, else `INTERNAL` |
| WebGL context lost | error handlers | `WEBGL_CONTEXT_LOST` |

```ts
import { TomTomMap, TomTomMapError } from '@tomtom-org/maps-sdk/map';

const createMap = (): TomTomMap | undefined => {
    try {
        return new TomTomMap({ mapLibre: { container: 'map' } });
    } catch (error) {
        if (error instanceof TomTomMapError && error.code === 'WEBGL_UNSUPPORTED') return undefined; // show a static fallback
        throw error;
    }
};

const map = createMap();
const removeErrorHandler = map?.addErrorHandler((error) => {
    if (error.code === 'INVALID_CREDENTIALS') showToast('Map could not load — check the API key');
    else if (error.code === 'INSUFFICIENT_PERMISSIONS') showToast('Map could not load — check the domains the key allows');
});
```

- `INVALID_CREDENTIALS` = a key the API does not know (`401`); `INSUFFICIENT_PERMISSIONS` = a valid key refused this page (`403`), on the map usually the key's domain restriction — add the page's domain to the key.

- While no handler is registered each failure is `console.error`ed, as MapLibre does — register one rather than `mapLibreMap.on('error')`.
- A failed tile does not stop the map; surface it, don't tear the map down.

---

## Module architecture

All map modules are async, and the factory name tells you who owns the layers being controlled:

- **Data-owned** (`PlacesModule`, `RoutingModule`, `GeometriesModule`, `ReachableRangesModule`, `CustomGeoJSONModule`, `TrafficIncidentDetailsModule`, `TrafficAreaAnalyticsModule`) — `await Module.create(map, optionalConfig)`. Each call returns a **new independent instance** owning its own sources, layers and images, so several can coexist on one map, each managing its own data.
- **Style-owned** (`BaseMapModule`, `POIsModule`, `TrafficFlowModule`, `TrafficIncidentsModule`, `TerrainModule`, `StylingFoundationsModule`) — `await Module.get(map, optionalConfig)`. These control layers the style already provides under fixed global IDs, so every instance is a handle on the **same shared state**. A config passed to a later `get()` replaces the one it holds, as `applyConfig` does (`StylingFoundationsModule` merges it, as `updateConfig` does).

```ts
const placesModule = await PlacesModule.create(map, optionalConfig);   // data-owned
const poisModule = await POIsModule.get(map, optionalConfig);          // style-owned

placesModule.setVisible(true);
placesModule.getShown();                              // current data on the map
const unsubscribe = placesModule.events.on('click', (feature, lngLat) => { });
placesModule.events.on('hover', (feature, lngLat) => { });
unsubscribe();                                        // removes only that handler
placesModule.events.off('click');                     // removes every click handler
```

### Who owns what — where each change lives

| You want to change… | Where | How |
|---|---|---|
| **Whether** a style part is shown: a base-map layer group or road part, traffic flow or incidents, a POI category, the hillshade, the 3D surface | Its style-owned module | `BaseMapModule.setVisible(…, { layerGroups })` and its road-part knobs (§ BaseMapModule), `TrafficFlowModule`/`TrafficIncidentsModule` `setVisible` and `updateConfig({ filters })`, `POIsModule.updateConfig({ filters: { categories } })`, `TerrainModule.setHillshadeVisible` / `setElevationVisible` |
| **How one part looks**: POI size, zoom and label colours, traffic colours and widths, hillshade lighting | That same module's look knobs | `setKnob(pois, poisKnobCatalogue, 'label.color', …)`, `setKnob(flow, trafficFlowKnobCatalogue, 'colors.slow', …)`, `setKnob(terrain, terrainKnobCatalogue, 'hillshade.intensity', …)` |
| **The foundations** across every part: label, icon and road sizes, the map colours, globe, sky | `StylingFoundationsModule` knobs (see `map-styling.md`) | `setKnob(styling, stylingFoundationsKnobCatalogue, 'labels.sizeFactor', …)`, `setMapColors` |
| A map preset (`data-viz`, `night-driving`, `minimal`, `globe`) | The map: Styling Foundations, BaseMap and POIs knobs at once | `await applyMapPreset(map, 'data-viz')` (`map-styling.md` § Presets) |
| Anything a data-owned module draws itself: routes, places, geometries, your GeoJSON, fetched traffic incidents, area analytics | That module's own config | `create(map, config)`, `applyConfig` / `updateConfig`, `setKnob`, `setVisible` |
| The map's colour identity: the accent routes, places and geometries default to | `StylingFoundationsModule` publishes it; each data-owned module reads it | `setMapColors`, `setKnob(styling, stylingFoundationsKnobCatalogue, 'colors.accent', …)`; a colour set on the module wins |

- **The map's foundations are never on a per-part module**, and a data-owned module's layers are never styled through the style-owned modules' knobs: those knobs don't reach them.
- **The knobs compose**: every style-owned module restyles the loaded style through one engine per map, so factors on one layer property multiply (`labels.sizeFactor` × `POIsModule`'s `sizeFactor` on POI labels) and every value lands again after `setStyle`.
- **Finer settings narrow coarser ones** within a module: `POIsModule`'s `microMarkers.visible` and `BaseMapModule`'s road parts only hide inside what the module and its groups show — `true` never shows a layer they hide, and showing them again keeps a part's `false`. `POIsModule`'s `zoomShift` composes with its `filters.categories`.
- **Which layers a module owns**: every module's `sourceAndLayerIDs`, style-owned and data-owned, `{ [sourceName]: { sourceID, layerIDs } }`. The source names of the style-owned ones: `BaseMapModule` `vectorTiles`, `POIsModule` `pois`, `TrafficFlowModule` `trafficFlow`, `TrafficIncidentsModule` `trafficIncidents`, `TerrainModule` `hillshade`; `StylingFoundationsModule` owns none (`{}`). `baseMap.getLayerIds(group)` narrows to one group. An app writing `visibility` or paint on module layers from its own state skips these ids to leave them to the module. Re-read after `setStyle` or a config change: a data-owned module can add or remove layers (route sections). A road part (`roads.arrows.visible`, …) has **no** public layer list.
- **Raw MapLibre writes on those layers are a fallback** for tweaks no knob offers, and don't compose with the modules:
  - `setStyle` drops every raw write; only the knobs are applied again.
  - A knob never computes from the app's value: factors and colours start from the style's or the module's own (`map-styling.md` § Gotchas).
  - Every module, `StylingFoundationsModule` included on the base-map and POI layers it reaches: a knob or any other config change replaces the app's value only on the layers and properties whose value it changes; the rest stays (`GeometriesModule`'s `line.color` keeps a raw `fill-opacity` and label `text-size`). A POI knob writes `text-color` on `POI`, not on the icon-only `POI - Micro`. `CustomGeoJSONModule` replaces the properties the app's new layer specs set differently.
  - A layer a data-owned module removes and adds back (the `TrafficIncidentDetailsModule` outline after `highlight: false`) loses the raw writes on it.
  - **Visibility** is the module's: traffic, terrain and data-owned modules set it on all their layers at every config change; `BaseMapModule` only on the groups and road parts a change toggles; `POIsModule` with `visible` unset reads it back from its layers, so hiding **all** of them by hand makes `isVisible()` false and the next change shows them again; `StylingFoundationsModule` never sets it.

### Changing a setting

Two ways in, one configuration (`getConfig()` reads it); a knob id is the setting's path in it, so `'label.color'` is `config.label.color`. Pick by **where the value comes from**:

| | Config methods: `get`/`create(map, config)`, `applyConfig(config)` (replaces), `updateConfig(partial)` | Knob functions: `setKnob(module, catalogue, id, value)`, `setKnobs(module, catalogue, { [id]: value })` |
|---|---|---|
| Use for | settings **your code writes**, typed | settings **held as data**: a control, `localStorage`, a URL, an LLM tool call, `JSON.parse` output |
| Reaches | every setting, incl. `layers` specs, callbacks, MapLibre expressions, `beforeLayerConfig` | only the plain-valued settings in the module's catalogue |
| Run-time check | **none** (TypeScript only) — an out-of-range or mistyped value is applied as given (on `MapEffects` too) | every value against its entry: `RangeError`, and **nothing** changes (`setKnobs`: not even the valid ones) |
| Nested settings | `updateConfig` merges **one level deep**: a nested object passed **replaces** the one there | set at the id's path, every sibling kept |

```ts
places.updateConfig({ label: { ...places.getConfig()?.label, color } });          // code: spread to keep the rest of `label`
setKnob(places, placesKnobCatalogue, 'label.color', color);                       // data: one, checked, by path
setKnobs(places, placesKnobCatalogue, JSON.parse(saved));                         // data: several, checked, one change and one config-change
```

- **Never pass untrusted input to `applyConfig`/`updateConfig`** — it bypasses every check. Save knob values by id and restore them with `setKnobs`.
- Named setters exist only for visibility (`setVisible`/`isVisible`, `setIconsVisible`, `setHillshadeVisible`, `setElevationVisible`, BaseMap `{ layerGroups }`) and Area Analytics' per-metric `setPalette` / `setColorStops` / `setHeight` / `setFilters`. A named setter is always `set<Setting>`.

### Appearance vocabulary — one name per concept

A concept has the same name on every module that has it; a module missing from a row lacks it.

| Concept | Name and rule | Where |
|---|---|---|
| Module colour | top-level `color`; unset → the map's accent (`colors.accent`, `map.mapColors.accent`) → module default; part colours override it | Routing `color` (under `layers.*`) · Geometries `color` (under `fill.palette`, `fill.color`, `line.color`, feature `color`) · Places `color` (under `icon.default.style.fillColor`, `label.color`, `layers.*`) |
| Labels | `LabelConfig`: `size`, `color`, `haloColor`, `haloWidth`, `opacity`, `font`, plus the module's own content and placement, a `distance` or an `offset` | Places `label` (`PlaceLabelConfig`: `title`, `distance` from the icon in ems) · Routing `waypoints.label` (`WaypointLabelConfig`: `title`, `visible`), `summaryBubbles.label` (`SummaryBubbleLabelConfig`: `size`, `color`, `opacity`, typeface fields, `title`; no halo) · Reachable ranges `lineLabel` (`ReachableRangeLineLabelConfig`: `title` function) · Geometries `label` (`GeometryLabelConfig`: optional `title`, string or expression, default the feature's own `title`), and `lineLabel` (`GeometryLineLabelConfig`: the same `title`, `minZoom`, `symbolSpacing`, `offset` `[x, y]` ems) |
| Multipliers | `*Factor`, clamped to a published range; a `*Preset` (`'s'`/`'m'`/`'l'`) picks the base | Routing `widthPreset` + `widthFactor`, `waypoints.sizePreset` + `waypoints.sizeFactor` (both 0.5–2), `sections.<type>.widthPreset` + `sections.<type>.widthFactor`, `sections.<type>.icon.sizeFactor` (0.25–2), `highlight.outline.widthFactor` (1–1.25), `highlight.section.outline.widthFactor` (0.5–2), `waypoints.highlight.sizeFactor` (1–1.5) · Geometries `highlight.fill.opacityFactor` (1–4), `highlight.line.widthFactor` (1–3) · TrafficIncidentDetails `highlight.line.widthFactor` (1–1.8) · POIs `sizeFactor` (0.5–1.5) · traffic flow and incidents `widthFactor` (0.5–2) · Styling Foundations `labels.sizeFactor`, `symbols.sizeFactor`, `roads.widthFactor` (0.5–1.5) |
| Hovered and clicked look | one look for both, once a handler covers the feature or `setEventState` puts a state; `highlight` holds its factors, `1` draws the feature as any other; a MapLibre layer given in its place draws as given | Routing `highlight.outline.widthFactor`, `waypoints.highlight.sizeFactor`, and `highlight.section.outline.color` + `highlight.section.outline.widthFactor` on the sections `setSectionFocus` rings · Geometries `highlight.fill.opacityFactor`, `highlight.line.widthFactor` · TrafficIncidentDetails `highlight.outline.color`, `highlight.line.widthFactor` (also the `setFocus` look; `highlight: false` off) · Places `layers.selected` |
| Absolute units | MapLibre's name, in pixels; other units in the name; opacity 0–1; label offsets in ems | pixels: `LabelConfig.size`/`haloWidth`, Geometries `line.width`, `lineLabel.symbolSpacing` · metres: Area Analytics `height.maxMeters`/`height.minMeters`, per unit of the metric `height.metersPerUnit` · `TerrainModule` `elevation.exaggeration` (surface height) ≠ its `hillshade.intensity` (shading) |
| Marker type / fill style / theme | *theme* = the map-wide look only | Places `markerType` (`placesMarkerTypes`) · Geometries `fill.style` (`geometryFillStyles`), per feature `properties.fillStyle` · Reachable ranges `fill.style` · Area Analytics `regionPolygon.fill.style` · map theme: `setMapColors` + map-theme plugin `deriveMapColors*` |
| Fill colour vs palette | a colour field never takes a palette name | Geometries `fill.color` (colour or expression), `fill.palette` (your own CSS colours) · Reachable ranges `fill.palette` (your own CSS colours; unset, an accent-to-land ramp) · Area Analytics `metrics.<metric>.palette` (`areaAnalyticsPalettes`), `metrics.<metric>.colorStops` wins over it |
| Zoom thresholds | `minZoom` / `maxZoom` | Places `entryPoints.minZoom` · Geometries `lineLabel.minZoom` · Routing `sections.<type>.sign.minZoom`, `countryCrossings.minZoom`, `summaryBubbles.minZoom`/`maxZoom` · POIs `minZoom` · Terrain `hillshade.maxZoom` |
| Borrowed looks | follow the knobs restyling what they borrow; a module setting wins | Places `base-map`/`circle-icon`/`pin-clustered`, Routing `sections.traffic` and `summaryBubbles`, TrafficIncidentDetails — knob list in `map-styling.md` |
| Visibility | `visible` + `setVisible` + `isVisible`; `isVisible` is the setting, as the `visible` knob reads; data-owned: hiding keeps data, `show`/`clear` leave it hidden, `getShown` is what's shown; style-owned unset: `isVisible` reads what the style draws, traffic `false`; style-owned `getRenderedFeatures` is what its tiles render in view | all three on Places, Routing, Geometries, Reachable ranges, CustomGeoJSON, TrafficIncidentDetails, Area Analytics, POIs, traffic flow, traffic incidents (+ `icons.visible`, `setIconsVisible`, `isIconsVisible`) · BaseMap `visible`, `groups.<group>.visible`, `{ layerGroups }` · Routing per part too (`summaryBubbles.visible`, `countryCrossings.visible`, `sections.<type>.visible`) · Terrain `setHillshadeVisible`, `setElevationVisible` · Styling Foundations `view.sky.visible` |
| Layer position | `beforeLayerConfig`: `'top'` or a named style layer, or a `{ all, <part> }` record (`PartsBeforeLayerConfig`) | Geometries `fill`/`line` · Routing `mainLines`/`instructionLines`/`icons` · Places `places`/`connections` · Reachable ranges `fill`/`line` · Area Analytics one part per display mode · TrafficIncidentDetails flat only · CustomGeoJSON module-wide and per layer, plus `{ layerID }` below a layer outside the style (`CustomGeoJSONBeforeLayerConfig`) |

### Every setting as data — `KnobEntry` and `KnobKind`

Each module's knob catalogue (`baseMapKnobCatalogue`, `placesKnobCatalogue`, `routingKnobCatalogue`,
`geometriesKnobCatalogue`, the traffic ones, `stylingFoundationsKnobCatalogue`, …; the map-effects plugin's
`effectKnobCatalogue`) is a list of `KnobEntry`s: `{ id, kind, description, default?, range?, options? }`,
static, no map needed. `id` is the setting's path in the config, never into a list: a list is one knob
(`colors`, `enums`, `offset`) or none. The union over `kind` makes a kind's fields required:

| `kind` (`KnobKind`) | Value (`KnobValueOf<kind>`) | Fields |
|---|---|---|
| `toggle` | `boolean` | — |
| `factor` | number, `1` = the style's own | `range` |
| `number` | number | `range` |
| `offset` | `[x, y]`, x right, y down; unit in `description` | `range`, per component |
| `color` | CSS colour | — |
| `enum` | one of `options` | `options` |
| `enums` | list of `options`; `description` says when order matters | `options` |
| `colors` | list of CSS colours or `options` names | `options`, optional |
| `image` | sprite image id | — |
| `text` | any string | — |

- `range` is the span a control offers (`step` for a slider). Its required `bounds` says which ends
  hold: `hard` both (opacities, `*Factor`s), `hard-min` only `min` (heights in metres: none below
  0, any above `max`), `soft` neither (offsets).
- `default` only where one value holds everywhere; otherwise `description` says what decides.
- Expressions, callbacks and structured objects stay out; a setting that also takes an expression is
  in with its plain values. Every module's `…KnobValueOf<ID>` is that plain value, never the
  expression or object the config also takes at the path.
- A UI switching on `kind` must handle every member: a new kind is a breaking change.

These functions work a knob by id on every module, `StylingFoundationsModule` and the map-effects plugin's
`MapEffects` included — there is no per-module `set` / `get` / `reset`:
- `setKnob(module, catalogue, id, value)` validates, then applies the config with the value at the
  id's path, the rest kept; the value is typed from the path (any value for an id typed `string`,
  checked at run time).
- `setKnobs(module, catalogue, values)` validates **every** value first, then applies them all in one
  config change (one `config-change`, one restyle); one refused value sets none. `values` is
  `KnobValues<CONFIG, ID>`: `{ [id]: value }`, each value typed from its path.
- `getKnob(module, catalogue, id)`: the value set, else the module's own (styling reads the loaded
  style), else the entry's `default`.
- `resetKnob(module, catalogue, id)` unsets it and drops the objects it empties: set then reset
  leaves `getConfig()` as it was. `resetConfig()` unsets every knob.

`knobEntryOf(catalogue, id)` reads one entry (kind, range or options, default). `validateKnobValue(entry, value)`
is the check alone, for untrusted input (forms, LLM tool calls). It, `setKnob` and `setKnobs` throw `RangeError` and change
nothing; the functions that take an id throw `Error` for one the catalogue lacks.

```ts
import { getKnob, knobEntryOf, resetKnob, setKnob, trafficFlowKnobCatalogue, validateKnobValue } from '@tomtom-org/maps-sdk/map';

setKnob(trafficFlow, trafficFlowKnobCatalogue, 'filters.roadCategories.values', ['motorway', 'trunk']);
getKnob(trafficFlow, trafficFlowKnobCatalogue, 'visible'); // false until set: the entry's default
resetKnob(trafficFlow, trafficFlowKnobCatalogue, 'filters.roadCategories.values');

const knob = knobEntryOf(trafficFlowKnobCatalogue, 'filters.roadCategories.values'); // kind, range or options, default
validateKnobValue(knob, ['motorway', 'cart track']); // RangeError: … 'cart track' is not
```

---

## BaseMapModule — layer control and background click detection

One shared module per map — a second `get(map)` returns the same instance. Name the layer groups
per call instead:

```ts
// `visible` first, then each `groups` entry in order; an entry without `visible` keeps the style's own
const baseMap = await BaseMapModule.get(map, { groups: { buildings3D: { visible: true } } });

baseMap.setVisible(false, {
    layerGroups: {
        show: 'only',    // 'only' | 'all-except' (all-except leaves the named groups as they were)
        values: ['roads', 'buildings2D'],
    },
});
baseMap.getConfig(); // { groups: { buildings3D: { visible: true }, roads: { visible: false }, buildings2D: { visible: false } } }
baseMap.isVisible({ layerGroups: { show: 'only', values: ['buildings3D'] } });
baseMap.getLayerIds('roadLabels');

// Detect clicks on non-feature areas (e.g. to deselect)
baseMap.events.on('click', (feature, lngLat) => { clearSelection(); });
```

- Every `setVisible` call is kept in `getConfig().groups` and restored by `setStyle`; a call without groups replaces the record with `{ visible }`. The road parts stay set.
- `isVisible` reads those settings, not the layers: `visible`, then `groups`, the later winning; a layer none of them reaches reports what the style draws.
- `applyConfig` **replaces**: what the new config leaves out goes back to the style. Merge with `updateConfig`.
- Showing a group shows every layer in it, including ones the style ships hidden (detailed road markings).

Layer group names (`baseMapLayerGroupNames`): `land`, `water`, `buildings2D`, `roads`, `railways`, `ferries`, `borders`, `buildings3D`, `natureLabels`, `roadLabels`, `roadShields`, `houseNumbers`, `smallerTownLabels`, `stateLabels`, `cityLabels`, `allPlaceLabels`, `capitalLabels`, `countryLabels`. `allPlaceLabels` spans the town, state, city, capital and country label groups.

**Road parts** — markings within the road groups, each hidden or shown on its own: `exitNumbers`, `arrows`, `restricted`, `underConstruction`.

```ts
const baseMap = await BaseMapModule.get(map, { roads: { exitNumbers: { visible: false }, arrows: { visible: false } } });
setKnob(baseMap, baseMapKnobCatalogue, 'roads.underConstruction.visible', false);
```

A part only hides inside what its group shows: `true` never shows it while `visible` or its group hides it, `false` survives the group showing again, and unset leaves it as the style ships it.

### Every knob as data — `baseMapKnobCatalogue`

Every `BaseMapModuleConfig` setting, static and readable with no map: all `toggle`s, with no
`default`, since unset leaves a layer as the style ships it. The id is the setting's path in the
config; `baseMapKnobIds` lists them in catalogue order.

```ts
import { baseMapKnobCatalogue, type BaseMapKnobId } from '@tomtom-org/maps-sdk/map';

const groupToggles = baseMapKnobCatalogue.filter(({ id }) => id.startsWith('groups.'));
// [{ id: 'groups.land.visible', kind: 'toggle', description: 'The `land` layer group: …' }, …]
const id: BaseMapKnobId = 'groups.buildings3D.visible';
```

- Ids: `visible`, then per group in `baseMapLayerGroupNames` order: `groups.land.visible`,
  `groups.water.visible`, `groups.buildings2D.visible`, `groups.roads.visible`,
  `groups.railways.visible`, `groups.ferries.visible`, `groups.borders.visible`,
  `groups.buildings3D.visible`, `groups.natureLabels.visible`, `groups.roadLabels.visible`,
  `groups.roadShields.visible`, `groups.houseNumbers.visible`, `groups.smallerTownLabels.visible`,
  `groups.stateLabels.visible`, `groups.cityLabels.visible`, `groups.allPlaceLabels.visible`,
  `groups.capitalLabels.visible`, `groups.countryLabels.visible`, then the road parts:
  `roads.exitNumbers.visible`, `roads.arrows.visible`, `roads.restricted.visible`,
  `roads.underConstruction.visible`.
- These are the only switches for a whole group or road part: `stylingFoundationsKnobCatalogue` has none, so 3D buildings
  are `setKnob(baseMap, baseMapKnobCatalogue, 'groups.buildings3D.visible', true)`.
- Entries are `KnobEntry`s, the shape `stylingFoundationsKnobCatalogue` and `routingKnobCatalogue` share.

---

## Events — precision and cursor

The map-wide events config (`MapEventsConfig`) is the `events` option of `new TomTomMap({ mapLibre, events })`. Event types, its fields and defaults, `updateEventsConfig` and per-module overrides: `user-events.md`.

---

## MapLibre direct access

`map.mapLibreMap` is the MapLibre `Map` itself — any MapLibre API, control or plugin works. Use it for what no SDK feature covers: controls, markers, popups, camera moves, lifecycle events, tile overlays. Your own GeoJSON goes through `CustomGeoJSONModule` (`custom.md`), and background clicks through `BaseMapModule` (above), not raw `addLayer` / `on('click')`. Why, and which SDK feature replaces which raw call: `maplibre.md` § SDK first.

```ts
import { NavigationControl } from 'maplibre-gl';

map.mapLibreMap.addControl(new NavigationControl(), 'top-right');
map.mapLibreMap.on('moveend', () => { /* viewport changed */ });
```

---

## Viewport utilities

Use these when surrounding UI panels (sidebars, search boxes, info panels) occupy part of the viewport — they account for the obscured area so the map content stays centred in the visible region.

All three take `map` and `surroundingElements`, an array of CSS selectors or `HTMLElement` references; selectors matching nothing and elements outside the map are skipped. `calculatePaddedBBox` and `calculateFittingBBox` also take an optional `paddingPX` (extra padding inside the visible area, default 0).

### `calculatePaddedBBox` — visible bbox, excluding panels

Returns the bounding box of the unobstructed map area. Use it as a search boundary so results only come from the area the user can actually see:

```ts
const visibleBBox = calculatePaddedBBox({
    map,
    surroundingElements: ['#sidebar', '#search-bar'],
    paddingPX: 10,
});

if (visibleBBox) {
    const places = await discoverPlaces({ query: 'coffee', geoBias: { boundingBox: visibleBBox } });
}
```

### `calculateFittingBBox` — fit content into the visible area

Returns a bbox padded so that when you `fitBounds()` with it, the content lands inside the visible area (i.e. not hidden under panels). Use this to focus the map on a set of results or a route while keeping them fully visible:

```ts
const contentBBox = bboxFromGeoJSON(places); // the bbox of your data

const fittingBBox = calculateFittingBBox({
    map,
    toBeContainedBBox: contentBBox,
    surroundingElements: ['#sidebar'],
    paddingPX: 40,
});

if (fittingBBox) {
    map.mapLibreMap.fitBounds(fittingBBox);
}
```

### `calculatePaddedCenter` — visual centre of the unobstructed area

Returns the geographic centre of the visible (unobstructed) viewport. Use it to place a pin or fly-to point that appears centred to the user:

```ts
const visibleCenter = calculatePaddedCenter({
    map,
    surroundingElements: ['#bottom-sheet'],
});

if (visibleCenter) {
    map.mapLibreMap.flyTo({ center: visibleCenter, zoom: 14 });
}
```

All three return `null` if the visible area is too small to be usable.

---

## TerrainModule

Hillshade shading and 3D elevation, both drawn from the elevation data of the `terrain` style part. `get()` adds that part when the style lacks it. The style parts the SDK adds — traffic flow, traffic incidents and the hillshade — are hidden until you show them, so without a config the hillshade is hidden and the surface stays flat (a terrain raised through `mapLibreMap` is kept until `elevation.visible` is set). Both are re-applied after `setStyle`.

```ts
const terrain = await TerrainModule.get(map, {
    hillshade: { visible: true },
    elevation: { visible: true, exaggeration: 1.5 },
});

terrain.setHillshadeVisible(false);
terrain.setElevationVisible(false); // flat again; the exaggeration is kept for next time
setKnob(terrain, terrainKnobCatalogue, 'elevation.exaggeration', 2); // 1 = true elevation; keeps `visible`
terrain.isHillshadeVisible(); // `hillshade.visible`; false unset
terrain.isElevationVisible(); // `elevation.visible`; unset: whether the map's own terrain is raised
terrain.events.on('config-change', (config) => {}); // lifecycle events only: the raster relief has no features
```

- 3D elevation needs a pitched camera: `mapLibre: { pitch: 70, maxPitch: 85 }` (MapLibre's default `maxPitch` is 60).
- The surface reads `TERRAIN_SOURCE_ID`, a copy of `HILLSHADE_SOURCE_ID` the module adds when elevation is first enabled (MapLibre degrades both when they share one source). Don't `setTerrain` on `HILLSHADE_SOURCE_ID` yourself.
- The shading's look (method, light direction, altitude and alignment, strength, max zoom, colours) is this module's too: `TerrainModule.get(map, { hillshade: { visible: true, intensity: 0.5, maxZoom: 22 } })` — standard styles fade the shading out by zoom 13, so city zooms need both. The sky above a tilted horizon is `view.sky.visible` (`map-styling.md`). `hillshade.intensity` is shading strength (0–1) and raises nothing; `elevation.exaggeration` is the vertical scale of the 3D surface (`1` = true elevation).
- Basemap 3D buildings (`buildings3D` layer group) and the Landmarks 3D plugin stand on the raised surface.

### Every knob as data — `terrainKnobCatalogue`

Every `TerrainModuleConfig` setting as a `TerrainKnob` (the shared `KnobEntry` shape), static and
readable with no map: `id`, `kind`, `description`, a `range` for the number and, where one value
holds everywhere, a `default`. The id is the setting's path in the config; `terrainKnobIds` lists
them, `TerrainKnobId` is their union and `TerrainKnobValueOf<ID>` the plain value one takes.

```ts
import { knobEntryOf, setKnob, terrainKnobCatalogue } from '@tomtom-org/maps-sdk/map';

const exaggeration = knobEntryOf(terrainKnobCatalogue, 'elevation.exaggeration');
// { id: 'elevation.exaggeration', kind: 'number', range: { min: 0.5, max: 3, step: 0.1, bounds: 'hard-min' }, default: 1, description: '…' }
setKnob(terrain, terrainKnobCatalogue, 'elevation.exaggeration', 2); // RangeError below 0.5
```

| Id | Kind | Default |
|---|---|---|
| `hillshade.visible` | toggle | `false` |
| `hillshade.method` | enum: `standard`, `basic`, `igor`, `combined`, `multidirectional` (four lights fanned over 135° around `hillshade.light.direction`) | — the style's |
| `hillshade.light.direction` | number 0–359, degrees clockwise from the top of the screen (from north with `hillshade.light.alignment` at `map`) | — the style's (335 cartographic) |
| `hillshade.light.altitude` | number 0–90, light height above the horizon (0 sunset, 90 noon); `basic`, `combined`, `multidirectional` only | — the style's (45) |
| `hillshade.light.alignment` | enum: `viewport` (light turns with the camera), `map` (light stays put as the map rotates) | — the style's (`viewport`) |
| `hillshade.intensity` | number 0–1, shading strength | — the style's |
| `hillshade.maxZoom` | number 10–22 | — the style's |
| `hillshade.colors.shaded`, `hillshade.colors.lit`, `hillshade.colors.steep` | color | — the style's |
| `elevation.visible` | toggle | — flat, unless MapLibre code raised a terrain |
| `elevation.exaggeration` | number, `hard-min` 0.5 (slider to 3) | `1`, true elevation |

- Not knobs: `events`. The colour ids are map-wide under `terrain.`: `getStyleColor(map, 'terrain.hillshade.colors.shaded')` (`map-styling.md`).
- Entry shape and kinds: § Every setting as data — `KnobEntry` and `KnobKind`, above.
