# MapLibre Direct Access (TomTom SDK context)

The TomTom SDK provides the basemap — vector tiles, style, glyphs, and sprites are all handled automatically. `map.mapLibreMap` is the MapLibre `Map` itself, unwrapped: any MapLibre API, control, plugin or snippet works on a TomTom map. That is a compatibility guarantee, not the default path — **use an SDK feature wherever one exists**.

## SDK first

Unlike raw MapLibre calls, SDK features:

- **Survive `setStyle`** — module data, config, layer placement and knobs are re-applied; raw sources, layers and images are wiped.
- **Survive style upgrades** — knobs and module settings are semantic and re-verified on every TomTom style release; raw layer ids and expressions are not a contract.
- **Coordinate events** — the top-most feature alone receives a click or hover, one cursor state, hover/long-hover timing, click tolerance, the original typed data in handlers, event states (`user-events.md`).
- **Follow the theme** — Routing, Places, Geometries and ReachableRanges take `colors.accent` (`map-theming.md`).
- **Are data** — knob catalogues, validated `setKnob`, serializable configs (`map-setup.md`, `module-events.md`).

| Instead of raw… | Use |
|---|---|
| `addSource`/`addLayer` with GeoJSON — even one layer | `CustomGeoJSONModule` (`custom.md`): the same layer specs, plus restoration and events |
| Layers for places, routes, polygons, isochrones | `PlacesModule`, `RoutingModule`, `GeometriesModule`, `ReachableRangesModule` (`places.md`, `routing.md`) |
| `setPaintProperty`/`setLayoutProperty` on style layers | `StylingFoundationsModule` knobs and `setMapColors`; `styling.layers` for what no knob covers (`map-styling.md`) |
| `setPaintProperty`/`setLayoutProperty` on a module's own layers (places, routes, geometries, incident details, area analytics) | That module's `layers` config — merged over its defaults and kept across `setStyle` |
| `'visibility'` on base-map, POI or traffic layers | `BaseMapModule`, `POIsModule`, traffic modules' `setVisible` (`map-setup.md`, `traffic.md`) |
| `addImage` and `icon-image` on the `POI` layer | `POIsModule` `icon.categoryIcons`, the same list `PlacesModule` takes (`places.md`) |
| `setTerrain`, hillshade layers | `TerrainModule` (`map-setup.md`) |
| `mapLibreMap.on('click', layerId, …)` | Module `events`; `BaseMapModule` for the rest of the map (`user-events.md`) |
| Re-adding layers on `style.load` | `CustomGeoJSONModule`, or `addStyleChangeHandler` (`map-styles.md`) |

**Raw MapLibre is right for:** controls, markers, popups; camera moves (`flyTo`, `fitBounds`); lifecycle events (`load`, `moveend`, `zoom`); vector, raster and PMTiles overlays (`CustomGeoJSONModule` takes GeoJSON only); third-party MapLibre plugins. The rest of this doc covers those raw calls.

## Accessing MapLibre

```ts
// Always use map.mapLibreMap for direct MapLibre access
const mapLibreMap = map.mapLibreMap;
```

Wait for the map to be ready before adding sources/layers:

```ts
mapLibreMap.on('load', () => {
  mapLibreMap.addSource('my-data', { type: 'geojson', data: myGeoJSON });
  mapLibreMap.addLayer({ id: 'my-layer', type: 'circle', source: 'my-data' });
});

// Alternative: check if already loaded (useful in async code)
if (!mapLibreMap.isStyleLoaded()) await mapLibreMap.once('styledata');
mapLibreMap.addSource('my-data', { type: 'geojson', data: myGeoJSON });
```

---

## Source types

| Type         | Best for                                                        |
| ------------ | --------------------------------------------------------------- |
| `geojson`    | Your own data — points, lines, polygons; no tile server needed  |
| `vector`     | Large datasets or zoom-dependent overlays (PMTiles, tile server)|
| `raster`     | Satellite imagery, WMS/WMTS, weather radar                      |
| `raster-dem` | Terrain / hillshade (TomTom SDK: use `TerrainModule` instead)   |

---

## GeoJSON sources

Default to `CustomGeoJSONModule` (`custom.md`) for GeoJSON — `module.show(data)` replaces `setData`. The performance thresholds below apply to both.

Inline object or URL to a `.geojson` file. The entire file is downloaded and rendered client-side — no tile server needed.

```ts
mapLibreMap.addSource('stores', {
  type: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: [ /* ... */ ]
  }
});

// Or from a URL
mapLibreMap.addSource('stores', { type: 'geojson', data: '/data/stores.geojson' });
```

### Update GeoJSON data at runtime

```ts
import { GeoJSONSource } from 'maplibre-gl';

const source = mapLibreMap.getSource('stores') as GeoJSONSource;
source.setData(updatedGeoJSON);
```

Avoid `null` values in GeoJSON feature properties — MapLibre's worker logs repeated type errors (e.g., "Expected value to be of type number, but found null"). Use `0` or omit the property instead.

### Performance thresholds

| Range      | File size / features             | Behavior                                                          |
| ---------- | -------------------------------- | ----------------------------------------------------------------- |
| Sweet spot | < 2 MB / < 5,000 features        | Instantaneous loading, smooth interaction                         |
| Lag zone   | 5–20 MB / ~50,000 features       | 1–3 s parse delay; simplify geometries, reduce coordinate precision |
| Crash zone | > 50 MB / > 100,000 features     | Switch to vector tiles                                            |

---

## Layer z-order — `mapStyleLayerIDs`

Layers draw bottom-to-top; `addLayer`'s second argument (`beforeId`) inserts your layer **below** the named one, and omitting it draws on top of everything. Any layer id present in the style is valid (`mapLibreMap.getStyle().layers` lists them), but prefer `mapStyleLayerIDs` — seven anchors the SDK keeps stable across the standard styles, and the ones its own modules use.

**Default for lines and polygons: `lowestLabel`** — every label and icon stays readable above your data. RoutingModule's route lines and ReachableRangesModule default to it; GeometriesModule defaults to the top. Points and markers usually belong on top, so omit `beforeId`.

```ts
import { mapStyleLayerIDs } from '@tomtom-org/maps-sdk/map';

mapLibreMap.addLayer(
  { id: 'zone', type: 'fill', source: 'my-data', paint: { 'fill-color': '#0080ff', 'fill-opacity': 0.4 } },
  mapStyleLayerIDs.lowestLabel  // below every label
);
```

| Constant (bottom → top) | Style layer                 | Your layer lands below…                                                       |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `lowestBuilding`        | `Buildings - Underground`   | the 2D building footprints, the whole road network, 3D buildings and labels    |
| `lowestRoadLine`        | `Tunnel - Railway outline`  | the road network, 3D buildings and labels; above the 2D building footprints    |
| `lowestLabel`           | `Borders - Treaty label`    | **every label and icon, and the 3D buildings right above it — the default for lines and polygons** |
| `lowest3D`              | `3D - Building`             | the 3D buildings and every label; above every layer placed before `lowestLabel` — **the anchor for a 3D custom layer** |
| `poi`                   | `POI`                       | POI icons and every place name                                                |
| `lowestPlaceLabel`      | `Places - Village / Hamlet` | every place name, from villages to countries; above the POIs                  |
| `country`               | `Places - Country name`     | country names and traffic incident markers only                               |

`lowestLabel` already keeps your layer above the roads and under the 3D buildings. Go lower only for a reason: `lowestRoadLine` to keep the road network drawn over a polygon fill, `lowestBuilding` to keep the 2D building footprints drawn over it too.

**Gotchas**

- `lowestRoadLine`, `lowestBuilding` and `lowest3D` are absent from the `streetSatellite` style. The SDK's own placement (module `beforeLayerConfig`, `map.addCustomLayer`) puts a layer anchored at `lowest3D` under `poi` there, and one at the other two on top. A missing anchor in a raw `addLayer` does **not** throw — MapLibre fires an `error` event (`Cannot add layer "x" before non-existing layer "y".`) and skips the layer, so the data silently never appears.
- `beforeId` only positions at insertion time. After `map.setStyle(...)` your raw MapLibre layers are gone — re-add them with the same anchor, or let `CustomGeoJSONModule` handle it.
- Reposition an existing layer with `mapLibreMap.moveLayer('my-layer', mapStyleLayerIDs.lowestLabel)`. Check the anchor exists first (`mapLibreMap.getLayer(anchor)`): `moveLayer` against a missing layer fires an `error` event and leaves the layer where it was. The SDK's own modules fall back to the top of the stack.

---

## Common layer types

```ts
import { MAP_REGULAR_FONT, mapStyleLayerIDs } from '@tomtom-org/maps-sdk/map';

// Circle (points)
mapLibreMap.addLayer({
  id: 'points', type: 'circle', source: 'my-data',
  paint: { 'circle-radius': 8, 'circle-color': '#e74c3c' }
});

// Line (roads, routes, tracks) — below labels
mapLibreMap.addLayer({
  id: 'route', type: 'line', source: 'my-data',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#3498db', 'line-width': 4 }
}, mapStyleLayerIDs.lowestLabel);

// Fill (polygon)
mapLibreMap.addLayer({
  id: 'zone', type: 'fill', source: 'my-data',
  paint: { 'fill-color': '#2ecc71', 'fill-opacity': 0.3 }
}, mapStyleLayerIDs.lowestLabel);

// Symbol (icon or text label)
mapLibreMap.addLayer({
  id: 'labels', type: 'symbol', source: 'my-data',
  layout: { 'text-field': ['get', 'name'], 'text-font': [MAP_REGULAR_FONT], 'text-size': 12 }
});
```

A text layer always names a `text-font` from the SDK's `MAP_*_FONT` constants (`mapFonts` lists them). The TomTom glyph endpoint doesn't serve MapLibre's default `Open Sans Regular`, so without one the text is drawn in a local browser font, with an `Unable to load glyph range` warning.

---

## Vector tile overlays

For large datasets or zoom-dependent rendering, use a vector source pointing to a tile URL or TileJSON endpoint.

```ts
// From a TileJSON endpoint (preferred — MapLibre reads schema automatically)
mapLibreMap.addSource('my-tiles', {
  type: 'vector',
  url: 'https://example.com/tiles.json'
});

// From a tile URL template directly
mapLibreMap.addSource('my-tiles', {
  type: 'vector',
  tiles: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14
});

// Layer must reference the correct source-layer name from the tile schema
mapLibreMap.addLayer({
  id: 'my-vector-layer',
  type: 'fill',
  source: 'my-tiles',
  'source-layer': 'parcels',       // must match tile schema exactly
  paint: { 'fill-color': '#f39c12', 'fill-opacity': 0.5 }
}, mapStyleLayerIDs.lowestLabel);
```

### Serverless vector tiles (PMTiles)

Host a single `.pmtiles` file on static storage — MapLibre fetches only the byte ranges it needs via HTTP range requests, no tile server required. See the [PMTiles docs](https://docs.protomaps.com/pmtiles/) for setup.

---

## Raster tile overlays

```ts
mapLibreMap.addSource('satellite', {
  type: 'raster',
  tiles: ['https://example.com/wmts/{z}/{x}/{y}.png'],
  tileSize: 256,
  attribution: '© Provider'
});

mapLibreMap.addLayer({
  id: 'satellite-layer',
  type: 'raster',
  source: 'satellite',
  paint: { 'raster-opacity': 0.7 }
}, mapStyleLayerIDs.lowestLabel);
```

---

## Runtime styling

Change paint and layout properties of your own raw layers without recreating them. Base-map, POI and traffic layers are restyled through knobs instead (`map-styling.md`); edits made here are lost on `setStyle`.

```ts
// Paint property (visual)
mapLibreMap.setPaintProperty('points', 'circle-color', '#e67e22');
mapLibreMap.setPaintProperty('zone', 'fill-opacity', 0.6);

// Layout property (geometry / text)
mapLibreMap.setLayoutProperty('labels', 'text-field', ['get', 'title']);
mapLibreMap.setLayoutProperty('route', 'visibility', 'none');  // hide a layer
mapLibreMap.setLayoutProperty('route', 'visibility', 'visible');
```

---

## Querying features

```ts
// Features visible in the current viewport (from specific layers)
const features = mapLibreMap.queryRenderedFeatures({ layers: ['points', 'zone'] });

// Features at a click position — raw layers only; this fires through overlapping module features,
// so use module events (user-events.md) for anything an SDK module draws
mapLibreMap.on('click', 'points', (e) => {
  const feature = e.features?.[0];
  console.log(feature?.properties);
});

// All features in a source (regardless of visibility)
const allFeatures = mapLibreMap.querySourceFeatures('stores', {
  sourceLayer: 'stores'   // only needed for vector sources
});
```

---

## Custom layers: three.js and raw WebGL

A `custom` layer draws your own WebGL scene inside the map. `localFrameMatrix` (`@tomtom-org/maps-sdk/map`) turns MapLibre's `defaultProjectionData.mainMatrix` into the matrix of a local frame around an origin: x east, y north, z up, in metres, composed in float64 and returned as a `Float64Array`. The online snippets on `map.transform` and `getMatrixForModel` don't compile against MapLibre 6: neither exists.

```ts
import { localFrameMatrix } from '@tomtom-org/maps-sdk/map';
import type { CustomLayerInterface } from 'maplibre-gl';
import { Camera, Scene, WebGLRenderer } from 'three';

const origin: [number, number] = [4.8932, 52.3731];
const scene = new Scene(); // meshes in metres around `origin`
const camera = new Camera();
let renderer: WebGLRenderer;

const threeLayer: CustomLayerInterface = {
  id: 'three-scene',
  type: 'custom',
  renderingMode: '3d', // shares depth with 3D buildings and terrain
  onAdd: (mapLibreMap, gl) => {
    renderer ??= new WebGLRenderer({ canvas: mapLibreMap.getCanvas(), context: gl, antialias: true }); // once: onAdd runs again on every re-add
    renderer.autoClear = false; // draw over the map, don't clear it
  },
  render: (_gl, options) => {
    const matrix = localFrameMatrix(options.defaultProjectionData.mainMatrix, origin, {
      centerLatitude: map.mapLibreMap.getCenter().lat,
    });
    camera.projectionMatrix.fromArray(matrix);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderer.resetState(); // MapLibre changed the GL state since three.js's last frame
    renderer.render(scene, camera);
  },
};

// Under the 3D buildings it shares depth with, kept there through every setStyle
const layer = map.addCustomLayer(threeLayer, { beforeLayerConfig: 'lowest3D' });
// layer.remove() takes it off for good
```

| Option | Default | Meaning |
|---|---|---|
| `altitude` | `0` | The origin's height above sea level, metres |
| `units` | `'meters'` | x and y in ground metres at the origin; `'mercatorMeters'` for EPSG:3857 metres (geometry authored in Web Mercator). z is metres in both |
| `centerLatitude` | origin's latitude | Pass `map.mapLibreMap.getCenter().lat`: MapLibre scales its 3D buildings' and terrain's heights at the map centre's latitude, so heights scale as theirs only with it |

- Metres are EPSG:3857's (WGS84 equatorial radius, 6378137), 0.11% longer than `MercatorCoordinate`'s (6371008.8): don't mix the two in one scene.

- **Raw WebGL**: `gl.uniformMatrix4fv(location, false, Float32Array.from(matrix))`. Vertices stay small numbers around the origin, which float32 holds; never fold a mercator position near 0.5 into float32 yourself.
- Mercator projection only, and a flat frame: keep a scene within a few km of its origin, or move the origin with the camera.
- **Add a custom layer with `map.addCustomLayer(layer, { beforeLayerConfig })`, not `mapLibreMap.addLayer`.** It adds it once the map is ready, below the anchor (default `'top'`), and puts it back after every `setStyle`, before the modules restore (style-change priority `-1`), so module layers go back over or under it as they were. `'lowest3D'` resolves to `3D - Building`, otherwise `POI`, otherwise the top, so route lines, areas and any module layer placed at `'lowest3D'` or before `lowestLabel` stay under it, even the ones added later; layers at `'poi'`, `'lowestPlaceLabel'`, `'country'` or `'top'` go over. A module layer placed at the same anchor as a custom layer always goes under it; two custom layers at one anchor stack in the order added, the last on top. An id the map already has throws, until that layer's `remove()`.
- **Clickable objects — `hitTest`**: `map.addCustomLayer(layer, { hitTest, setState?, events? })` makes what the layer draws join the SDK's user events. `hitTest(point)` gets MapLibre's pixel point and returns `[{ id, properties? }]`, the topmost first; `layer.events.on('click' | 'hover' | 'long-hover' | …, handler)` then receives those objects. The hits merge with the rendered features in layer order, so the topmost wins: a vehicle over a road takes the click and the road's handler stays silent, while a module layer drawn above the custom layer takes it instead. Cursor (`events.cursorOnHover`) and hover/click states work as on a module; the layer has no feature state, so `setState(id, state)` receives `'hover'`, `'long-hover'`, `'click'`, `'contextmenu'`, `'recently-hovered'` or `undefined` to draw it.
  - The hit tester owns depth: a screen-projection pick also hits an object behind a 3D building. Layer order, not draw depth, ranks the hits: with a handler on the 3D buildings, a click on a `'lowest3D'` object in front of a building goes to the building. Project positions through the matrix of the last frame rather than raycasting; it runs on every pointer move while a handler listens.
  - `setState` and `events` need `hitTest` (the type rejects them alone); without one, `layer.events.on` registers nothing.
- **Many moving objects**: one `InstancedMesh` per model, instance matrices rewritten every frame. On Chrome / ANGLE / Direct3D 11 a `bufferSubData` into a buffer drawn in recent frames stalls the GPU process (usage hints and indexed draws don't help): rotate **three** `InstancedBufferAttribute` sets over one CPU `Float32Array`, each set with its own `BufferGeometry` sharing the shape's attributes and index, and set `mesh.geometry`, `mesh.instanceMatrix`, `addUpdateRange(0, count * 16)` and `needsUpdate` on the next set each frame. The guide's *Drawing many moving objects* section has the code.
- Guide: `https://docs.tomtom.com/maps-sdk-js/guides/map/three-js-custom-layers.md`.

---

## Style switching with TomTom

`map.setStyle()` replaces the TomTom style but **removes all custom sources and layers**. SDK modules (RoutingModule, PlacesModule, etc.) survive style changes automatically, and so do custom layers added with `map.addCustomLayer` — only your own MapLibre sources and layers need re-adding. A style change handler runs after every switch, until you unsubscribe:

```ts
const addMyLayers = () => {
  // The mapStyleLayerIDs anchors keep their IDs in the new style (satellite lacks lowestRoadLine, lowestBuilding and lowest3D).
  mapLibreMap.addSource('my-data', { type: 'geojson', data: myGeoJSON });
  mapLibreMap.addLayer({ id: 'my-zone', type: 'fill', source: 'my-data' }, mapStyleLayerIDs.lowestLabel);
  mapLibreMap.addLayer({ id: 'my-layer', type: 'circle', source: 'my-data' });
};

const unsubscribe = map.addStyleChangeHandler({ onStyleChanged: addMyLayers });
await map.setStyle('monoDark');
```

Re-adding by hand is what `CustomGeoJSONModule` exists to avoid — it restores sources, layers (including each layer's `beforeLayerConfig` placement), images and data for you. See `custom.md`.

---

## Removing sources and layers

A source cannot be removed while layers still reference it — remove layers first:

```ts
mapLibreMap.removeLayer('my-layer');
mapLibreMap.removeSource('my-data');
```

---

## CORS

If your tile or GeoJSON files are on a different origin, the server must respond with `Access-Control-Allow-Origin`. Without this the browser blocks the request and the layer renders blank. Configure CORS on your CDN or server.

---

## References

- [MapLibre GL JS Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/)
- [PMTiles](https://docs.protomaps.com/pmtiles/)
- [awesome-maplibre — Tile Providers & Servers](https://github.com/maplibre/awesome-maplibre#maptile-providers)
