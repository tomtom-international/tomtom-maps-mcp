# Custom GeoJSON Module Reference

`CustomGeoJSONModule` renders arbitrary GeoJSON with caller-authored MapLibre layer specs and adds the SDK lifecycle: style-change restoration, per-source user events, module events, managed source/layer IDs. Use it for any GeoJSON no opinionated module (`PlacesModule`, `GeometriesModule`, …) fits — even one layer: the specs are the ones raw `addLayer` takes for the six layer types a GeoJSON source draws (`circle`, `heatmap`, `fill`, `fill-extrusion`, `line`, `symbol`), so it costs no styling freedom over raw MapLibre.

## Imports

```ts
import { CustomGeoJSONModule, MAP_REGULAR_FONT } from '@tomtom-org/maps-sdk/map';
import type {
    CustomGeoJSONLayerSpec,
    CustomGeoJSONModuleConfig,
    CustomGeoJSONModuleSerializableConfig,
    CustomGeoJSONSourceSpec,
} from '@tomtom-org/maps-sdk/map';
import type { FeatureCollection, Point, Polygon } from 'geojson';
```

---

## Basic usage

```ts
const module = await CustomGeoJSONModule.create(map, {
    sources: {
        points: {
            layers: [{ type: 'circle', paint: { 'circle-radius': 4, 'circle-color': '#0a3653' } }],
        },
    },
});

await module.show(featureCollection, 'points');
module.events.points.on('click', (feature, lngLat) => { /* ... */ });
```

`config.sources` is required with at least one source, each with at least one layer — `create` throws otherwise. Source names `on`, `off` and `where` are reserved (they would shadow the events object's methods): `create` throws on them. Every `create` returns a new, independent instance; several can share a map.

---

## Typed multi-source modules

```ts
type Sources = {
    heatmap: FeatureCollection<Point>;
    buildings: FeatureCollection<Polygon, { name: string }>;
};

const module = await CustomGeoJSONModule.create<Sources>(map, {
    sources: {
        heatmap:   { layers: [{ type: 'heatmap', paint: { 'heatmap-radius': 12 } }] },
        buildings: { layers: [{ type: 'fill',    paint: { 'fill-color': '#5a5' } }] },
    },
});

await module.show(heatmapData, 'heatmap');     // typed FeatureCollection<Point>
await module.show(buildingsData, 'buildings'); // typed FeatureCollection<Polygon, { name: string }>
await module.show(buildingsData);              // no name: every source (same data, several renderings)
```

Without the generic, every source takes `FeatureCollection`.

---

## Method surface

```ts
class CustomGeoJSONModule<TSources extends Record<string, FeatureCollection> = Record<string, FeatureCollection>> {
    static create<TSources>(map: TomTomMap, config: CustomGeoJSONModuleConfig<TSources>): Promise<CustomGeoJSONModule<TSources>>;

    show<K extends keyof TSources>(data: TSources[K], sourceName?: K): Promise<void>; // no name: every source
    clear(sourceName?: keyof TSources): Promise<void>;                                 // no name: every source
    getShown(): { [K in keyof TSources]: TSources[K] };
    setVisible(visible: boolean): void;
    isVisible(): boolean;  // the `visible` setting, `true` unless set

    applyConfig(config: CustomGeoJSONModuleConfig<TSources> | undefined): void; // undefined = resetConfig()
    updateConfig(partial: Partial<CustomGeoJSONModuleConfig<TSources>>): void;  // one-level merge
    resetConfig(): void;   // back to the config `create` was given — the module has no defaults
    getConfig(): CustomGeoJSONModuleConfig<TSources>; // never undefined

    setEventState(options): void; clearEventState(options): void; clearEventStates(options?): void; getEventStates(); // every source
    get sourceAndLayerIDs(): Record<keyof TSources, { sourceID: string; layerIDs: string[] }>;
    get events(): CustomGeoJSONEvents<TSources>; // module events + one user-events scope per source name
}
```

A source's layers draw while it holds features and the module is visible; a layer whose spec sets `layout.visibility: 'none'` stays hidden. `setVisible(false)` hides every layer of every source and keeps the data: `show()` and `clear()` leave a hidden module hidden; `setVisible(true)` draws the sources holding features again.

`CustomGeoJSONModuleSerializableConfig` is `getConfig()` minus `images` — what survives `JSON.stringify`; pass `images` again on replay.

---

## Source and layer IDs

| Field     | Default when omitted                            |
|-----------|-------------------------------------------------|
| Source ID | `custom-geojson-${instanceIndex}-${sourceName}` |
| Layer ID  | `${sourceID}-layer-${layerIndex}`               |

Give explicit IDs when you mutate the layer set via `applyConfig` (generated layer IDs are position-based) or need stable references for `queryRenderedFeatures` / `setPaintProperty`. `module.sourceAndLayerIDs` holds the resolved ones:

```ts
const ids = module.sourceAndLayerIDs;
// { points: { sourceID: 'custom-geojson-0-points', layerIDs: ['custom-geojson-0-points-layer-0'] } }
```

A raw `setPaintProperty` on those layers lasts until a config change sets that property differently in the layer specs, or `setStyle`, which drops it. Put the value in the layer spec instead (`map-setup.md` § Who owns what).

## Feature IDs (auto-normalized)

`show()` makes `feature.id` and `feature.properties.id` match: an explicit value on either is kept and copied to the other (`feature.id` wins when both are set and differ); with neither, both become the array index, or the next number no other feature holds. Event lookup reads `properties.id`, else `feature.id`. Needed because MapLibre disables `promoteId` on clustered sources — without it every clustered point has `feature.id === undefined` and every click resolves to the first feature.

---

## Events

Per source, `module.events.<sourceName>` — user events (`click`, `hover`, `long-hover`, `contextmenu`) over that source's layers, with `on` / `off` / `where` and the event-state methods:

```ts
const unsubscribe = module.events.points.on('click', (feature, lngLat, features) => { /* ... */ });
module.events.points.on('hover',       (feature) => { /* ... */ });
module.events.points.on('long-hover',  (feature) => { /* ... */ });
module.events.points.on('contextmenu', (feature, lngLat) => { /* ... */ });
unsubscribe();
module.events.points.off('click');

module.events.points.setEventState({ id: 'depot-1', state: 'click' }); // this source only
const { click = [] } = module.events.points.getEventStates();
```

Module-wide, `module.events` — lifecycle events plus user events over every source. `shown-features` names the source `show` wrote:

```ts
module.events.on('shown-features', ({ sourceName, data }) => { /* ... */ });
module.events.on('config-change',  (config) => { /* ... */ });
```

`module.setEventState(…)` and siblings act on every source; use a source's scope when ids repeat across sources. Event mechanics: `user-events.md`, `module-events.md`.

---

## Multiple layers per source

Order in `layers` is MapLibre draw order (later on top).

```ts
// Dot + label
markers: {
    layers: [
        { type: 'circle', paint: { 'circle-radius': 6, 'circle-color': '#0a3653' } },
        {
            type: 'symbol',
            layout: {
                'text-field': ['get', 'name'],
                'text-font': [MAP_REGULAR_FONT],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-optional': true,
            },
            paint: { 'text-color': '#0a3653', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
        },
    ],
},
```

**Every text layer names a `text-font`** from `mapFonts`: `MAP_REGULAR_FONT`, `MAP_MEDIUM_FONT`, `MAP_BOLD_FONT`, `MAP_ITALIC_FONT` and the style's `NotoSerif-*` and `NotoSans-*Italic` faces, the ones a label can name. It leaves out the `NotoSans-Condensed*` faces the style draws some of its own labels in. The serif faces lack Arabic and the italics cover only Latin, Greek and Cyrillic, so end a stack naming one with the `Noto-*` face of the same weight. Without a `text-font`, MapLibre asks for `Open Sans Regular`, gets a 404, warns `Unable to load glyph range` and draws a local browser font.

---

## Layer placement — `beforeLayerConfig`

Layers go where `beforeLayerConfig` says, as on every other module: `'top'` (the default) or a `mapStyleLayerIDs` key such as `'lowestLabel'`, the layer inserted **below** that style layer (full anchor table in `maplibre.md`).

- **Module-level** `beforeLayerConfig` places every layer; a layer's own wins over it.
- **`{ layerID }`** (`CustomGeoJSONBeforeLayerConfig`) goes below a layer the style lacks: another layer of this module, or one another module added.
- **Default for lines and polygons: `'lowestLabel'`**, so labels and icons stay readable above the data; points usually stay on `'top'`. `'lowestLabel'` also sits under the 3D buildings. `'lowestRoadLine'` lets the road network paint over a fill; `'lowestBuilding'` the 2D building footprints too.

```ts
const module = await CustomGeoJSONModule.create(map, {
    beforeLayerConfig: 'lowestLabel', // every layer, unless it names its own
    sources: {
        zones: {
            layers: [
                // Fill + outline below the labels; array order keeps the outline above the fill
                { id: 'zones-fill', type: 'fill', paint: { 'fill-color': '#2A5BD7', 'fill-opacity': 0.35 } },
                { type: 'line', paint: { 'line-color': '#2A5BD7', 'line-width': 2 } },
                { type: 'circle', beforeLayerConfig: 'top', paint: { 'circle-radius': 4 } },
            ],
        },
    },
});

// A second module's heatmap goes below the first one's zones.
await CustomGeoJSONModule.create(map, {
    sources: { heat: { layers: [{ type: 'heatmap', beforeLayerConfig: { layerID: 'zones-fill' } }] } },
});
```

- The placement is re-applied after every style change.
- `applyConfig` honours it for added layers and **moves an existing layer whose placement changed**, along with layers anchored on it.
- **`'lowest3D'`** goes under the style's 3D buildings, otherwise under `poi`: for `fill-extrusion` layers sharing the buildings' depth.
- **Gotcha:** a target the map lacks puts the layer on top, above the labels, rather than failing: a mistyped `layerID`, or `'lowestRoadLine'` / `'lowestBuilding'` on `streetSatellite`, which has neither.
- A MapLibre `custom` layer (three.js, WebGL) isn't GeoJSON: add it with `map.addCustomLayer(layer, { beforeLayerConfig })`, which takes `'top'` and the `mapStyleLayerIDs` names (no `{ layerID }`) and keeps it placed through `setStyle` (`maplibre.md` § Custom layers).

---

## Symbol layers with custom icons — `config.images`

Declare every `icon-image` the layers reference in `config.images`. The module registers each entry **before** creating sources/layers, and again on every style change — no `StyleChangeHandler`, and a symbol layer never renders against a missing image.

```ts
const module = await CustomGeoJSONModule.create(map, {
    sources: {
        markers: {
            layers: [{ type: 'symbol', layout: { 'icon-image': 'my-marker', 'text-field': ['get', 'name'], 'text-font': [MAP_REGULAR_FONT] } }],
        },
    },
    images: {
        'my-marker': { image: myImageBitmap, options: { pixelRatio: 2 } },
    },
});
```

- `image`: `HTMLImageElement`, `ImageBitmap`, `ImageData`, `StyleImageInterface`, or `{ width, height, data: Uint8Array | Uint8ClampedArray }`. **No URLs or raw SVG strings** — pre-load to a loaded `HTMLImageElement`.
- `options`: `Partial<StyleImageMetadata>` (`pixelRatio`, `sdf`, `stretchX`, `stretchY`, `content`), forwarded verbatim.
- An id already on the map (`map.hasImage(id)`) that another owner added is skipped — several modules may register the same icon.
- `applyConfig` registers new entries, and replaces an image the module added itself when its `image` (by reference) or `options` change; removing an entry never calls `removeImage`.

---

## Clustering

MapLibre cluster options per source; layer filters split clusters from points:

```ts
incidents: {
    cluster: { cluster: true, clusterRadius: 50, clusterMaxZoom: 14 },
    layers: [
        { type: 'circle', filter: ['has', 'point_count'],         paint: { 'circle-radius': 18 } },
        { type: 'symbol', filter: ['!', ['has', 'point_count']],  layout: { 'icon-image': 'marker' } },
    ],
},
```

- Fixed at creation; recreate the module to change them.
- Clusters are synthetic and not in the shown features: in `events.<name>.on('click', (feature) => …)`, `feature` is then the rendered MapLibre cluster feature, its `properties` carrying `cluster: true`, `cluster_id`, `point_count`, `point_count_abbreviated`.

---

## Updating layers at runtime via applyConfig

Layer specs live in `config.sources`, so `applyConfig` / `updateConfig` change them. The diff is by layer ID:

- In old and new → **update** paint/layout/filter/zoom in place, and move it if its placement changed.
- In old and new with a different `type` → **replace**: removed and added again, as MapLibre keeps a layer's type for life.
- New only → **add**.
- Old only → **remove**.

```ts
const module = await CustomGeoJSONModule.create(map, {
    sources: { points: { layers: [{ id: 'points-dot', type: 'circle' }] } },
});

module.applyConfig({
    sources: {
        points: {
            layers: [
                { id: 'points-dot',   type: 'circle', paint: { 'circle-radius': 6 } },
                { id: 'points-label', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-font': [MAP_REGULAR_FONT] } },
            ],
        },
    },
});
```

Not supported: adding or removing source names, changing a `sourceID` or `cluster` — recreate the module.
`applyConfig` throws on changed source names or a changed `sourceID`, before changing anything.

---

## Aggregating points into areas — `aggregateIntoCells` (core)

A `heatmap` layer shows **density weighted by the value**, not the value: many cheap points outshine a few expensive ones. `clusterProperties` can sum, but clusters regroup on every zoom and cannot give a median. For "the median / mean of a property per area" (price per m², rent, sensor readings), aggregate in `core`, then draw the cells:

```ts
import { aggregateIntoCells } from '@tomtom-org/maps-sdk/core';

const cells = aggregateIntoCells(listings, {     // FeatureCollection<Point, P>
    grid: 'hex',                                 // 'hex' | 'square' | FeatureCollection<Polygon | MultiPolygon> (districts)
    cellSizeKM: 1,                               // hex/square only: the side, = a hexagon's centre-to-corner distance
    gridOrigin: cityCentre,                      // optional: centre of one cell; default the points' bbox centre
    value: 'pricePerSquareMeter',                // numeric property key, or (point) => number | null | undefined
    stats: ['median', 'mean', 'count'],          // 'count' | 'sum' | 'mean' | 'median' | 'min' | 'max'
    minCount: 5,                                 // drop cells with fewer points (default 1; below 1 counts as 1)
});
// FeatureCollection<Polygon, { median: number; mean: number; count: number }>

const prices = await CustomGeoJSONModule.create<{ cells: typeof cells }>(map, {
    beforeLayerConfig: 'lowestLabel',
    sources: {
        cells: {
            layers: [{
                type: 'fill',
                paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'median'], 3500, '#2c7bb6', 9500, '#d7191c'], 'fill-opacity': 0.7 },
            }],
        },
    },
});
await prices.show(cells, 'cells');
prices.events.cells.on('hover', (cell) => cell.properties); // { median, mean, count }
```

- **Return type follows the options**: one property per entry of `stats`; with your own polygons, each keeps its geometry, `id` and properties, the statistics added (`FeatureCollection<G, P & { median: number }>`). A grid cell's `id` is `'<grid>:<column>:<row>'`.
- **No `value`** → each cell only counts its points (`stats` may only hold `'count'`). A point whose value is missing or not finite is left out of every statistic, `count` included.
- **Grid cells are indexed from coordinates** (no point-in-cell search), so it scales with the points; every point gets a cell, cells around the antimeridian stay adjacent (longitudes may pass ±180). Own polygons: bbox prefilter + point-in-polygon; a point in several polygons counts in each.
- **Cells move with the data unless `gridOrigin` is fixed**: the default origin is the points' bbox centre, so filtering the points shifts the grid. Pass the same `gridOrigin` (the city centre) on every call.
- **`CustomGeoJSONModule` never aggregates**: `show` draws what it gets. For a cell size that follows the zoom, aggregate again on `zoomend` and `show` the result.
- **A `grid` that may be either** (`useDistricts ? districts : 'hex'`) is a type error: narrow it first, as only `'hex'` / `'square'` take `cellSizeKM`.
- Pure `core`: runs in Node.js, no map needed. Throws on a `cellSizeKM` that isn't a positive finite number, with or without points.

---

## Style-change restoration — what you get for free

On `map.setStyle(...)`:

1. `config.images` are registered again first.
2. Sources and layers stay on the map under the same IDs, drawing through the switch (`resetState: true` adds them afresh, empty, with the config `create` was given).
3. Each source's last `show()` data is shown again.
4. Event handlers (user and module) keep firing.

---

## Every knob as data — `customGeoJSONKnobCatalogue`

The `CustomGeoJSONModuleConfig` settings a knob holds, as `CustomGeoJSONKnob`s (the shared
`KnobEntry` shape), static and readable with no map; `customGeoJSONKnobIds` lists them,
`CustomGeoJSONKnobId` is their union and `CustomGeoJSONKnobValueOf<ID>` the plain value one takes.

```ts
import { customGeoJSONKnobCatalogue, setKnob } from '@tomtom-org/maps-sdk/map';

customGeoJSONKnobCatalogue;
// [{ id: 'visible', kind: 'toggle', description: '…', default: true }]
setKnob(module, customGeoJSONKnobCatalogue, 'visible', false);
```

- `visible`: toggle, default `true`. The only one: the module draws with your own MapLibre styling.
- Not knobs, per source: `layers` (raw MapLibre layer specs, passed through untouched), `cluster`
  (MapLibre source options, forwarded verbatim and fixed at creation), `sourceID` (a name).
- Not knobs, module-wide: `images` (image payloads), `beforeLayerConfig` (a layer placement) and `events`.
- Entry shape, kinds and `setKnob` / `getKnob` / `resetKnob`: `map-setup.md` § Every setting as data — `KnobEntry` and `KnobKind`.

---

## When to use this module vs. alternatives

| Need                                              | Use                                              |
|---------------------------------------------------|--------------------------------------------------|
| Render typed TomTom-shaped points                 | `PlacesModule`                                   |
| Render polygon geometry with TomTom theming       | `GeometriesModule`                               |
| Render any other GeoJSON, even one layer          | **`CustomGeoJSONModule`**                        |
| Colour areas by a statistic of your points (median per hexagon, per district) | `aggregateIntoCells` (`core`), its cells drawn by `CustomGeoJSONModule` |
| Vector, raster or PMTiles overlay (not GeoJSON)   | `map.mapLibreMap.addSource` + `.addLayer` (`maplibre.md`) |

---

## Common gotchas

- **`show()` does not reveal a hidden module** — data shown while `visible` is `false` is kept and draws on `setVisible(true)`.
- **`resetConfig()` returns to the creation config**, not to an empty module.
- **Custom images go in `config.images`**, not raw `map.mapLibreMap.addImage` — the latter is lost on the next `setStyle`.
- **Not a theme follower**: a map theme's accent (`map-theming.md`) does not recolour these layers; read `map.mapColors.accent` yourself.
