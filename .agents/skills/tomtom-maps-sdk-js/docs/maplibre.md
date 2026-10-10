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

Layers draw bottom-to-top; `addLayer`'s second argument (`beforeId`) inserts your layer **below** the named one, and omitting it draws on top of everything. Any layer id present in the style is valid (`mapLibreMap.getStyle().layers` lists them), but prefer `mapStyleLayerIDs` — six anchors the SDK keeps stable across the standard styles, and the ones its own modules use.

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
| `poi`                   | `POI`                       | POI icons and every place name                                                |
| `lowestPlaceLabel`      | `Places - Village / Hamlet` | every place name, from villages to countries; above the POIs                  |
| `country`               | `Places - Country name`     | country names and traffic incident markers only                               |

`lowestLabel` already keeps your layer above the roads and under the 3D buildings. Go lower only for a reason: `lowestRoadLine` to keep the road network drawn over a polygon fill, `lowestBuilding` to keep the 2D building footprints drawn over it too.

**Gotchas**

- `lowestRoadLine` and `lowestBuilding` are both absent from the `streetSatellite` style. A missing anchor does **not** throw — MapLibre fires an `error` event (`Cannot add layer "x" before non-existing layer "y".`) and skips the layer, so the data silently never appears.
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

## Style switching with TomTom

`map.setStyle()` replaces the TomTom style but **removes all custom sources and layers**. SDK modules (RoutingModule, PlacesModule, etc.) survive style changes automatically — only your own MapLibre sources and layers need re-adding. A style change handler runs after every switch, until you unsubscribe:

```ts
const addMyLayers = () => {
  // The mapStyleLayerIDs anchors keep their IDs in the new style (satellite lacks lowestRoadLine and lowestBuilding).
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
