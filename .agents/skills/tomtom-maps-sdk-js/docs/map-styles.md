# Map Styles Reference

## Imports

```ts
import {
    TomTomMap,
    type StyleChangeHandler,
    type StyleChangeContext,
    type SetStyleOptions,
    type StyleInput,
    type StandardStyleID,
    type StylePart,
    standardStyleIDs,
    styleParts,
} from '@tomtom-org/maps-sdk/map';
```

---

## Available style IDs

`streetLight` (default), `streetDark`, `streetLightDriving`, `streetDarkDriving`, `monoLight`, `monoDark`, `streetSatellite`

`streetSatellite` is imagery with the vector roads and labels drawn over it. Each ID is the camelCase form of the Orbis style it loads (`streetLightDriving` → `basic_street-light-driving`).

`standardStyleIDs` is a readonly array of all valid IDs — use it to populate a style picker without hardcoding.

The map loads these standard styles only: it takes no style URL or style JSON. For a branded look, restyle a standard style at runtime with `StylingFoundationsModule` and `setMapColors` (`map-styling.md`).

---

## Setting a style

```ts
// At construction
const map = new TomTomMap({
    mapLibre: { container: 'map' },
    style: 'streetDark',
});

// After construction — carries all SDK module state over by default
map.setStyle('monoDark');

// Wait until the new style is loaded and every module has restored itself onto it
await map.setStyle('monoDark');

// Clean switch — modules re-bind with default config and nothing shown (language and geopolitical view are kept)
map.setStyle('streetLight', { resetState: true });

// With explicit style parts
map.setStyle({
    type: 'standard',
    id: 'streetLight',
    include: ['trafficFlow', 'trafficIncidents', 'terrain'],
});
```

`include` takes `StylePart`s, the optional parts of a standard style: `'trafficFlow'`, `'trafficIncidents'` and `'terrain'` (the elevation data hillshade and 3D terrain draw from), all listed in `styleParts`. Leave it out for all of them, pass `[]` for none. Loaded parts stay hidden until their module shows them. A part left out is added back by its module's `get()` (`TrafficFlowModule`, `TrafficIncidentsModule`, `TerrainModule`), which reloads the style with it — a `setStyle` that runs the style change handlers. A switch that carries state, to a style naming no `include`, keeps the previous style's parts.

`map.getStyleInput()` returns the `StyleInput` last given to the map, as given: a style id or the object above. It is not the resolved style specification: read that with `map.mapLibreMap.getStyle()`, or `StylingFoundationsModule.exportStyle()` for one with the styling knobs applied.

`setStyle(style, options?: SetStyleOptions)` returns `Promise<void>`:

- Resolves once the style has loaded and every style change handler, the SDK modules' included, has finished.
- Rejects if the style itself fails to load: the map keeps its previous style and `map.mapReady` stays `false`. A failing tile or source does not fail the switch.
- A second `setStyle` while one is in flight supersedes it: only the last style is applied, and both promises resolve.
- Passing the style already loaded runs the lifecycle without reloading it.

A switch that carries state keeps the modules' layers drawing through it: they take on the new style's look in place rather than being removed and re-added, so routes, places and geometries never blink out. Layers added through `map.mapLibreMap` are not kept.

`resetState: true` is the way to clear the map: every module comes back bound to the new style with default configuration and nothing shown, so a reset is one call rather than a `clear()` per module. Reach for it when a conversation, a session or a view starts over — it is what the agent-toolkit `reset` tool does. Passing the style already loaded resets the modules over the current map, without reloading the style. The map language and geopolitical view are configuration rather than state, so neither kind of switch touches them: only `setLanguage` and `setGeopoliticalView` change them.

---

## Style change lifecycle — `addStyleChangeHandler`

Register a handler to react when a style transition begins or completes. Both callbacks are optional, may be `async`, and receive a `StyleChangeContext` (`{ resetState: boolean }`). An optional `priority` (default `0`) orders it: lower runs first, ties in registration order. The SDK modules restore at `0`, the style knobs land at `90`, `StylingFoundationsModule`'s raw layer edits at `100` — use a `priority` above `100` to run after all of them. `addStyleChangeHandler` returns an unsubscribe function.

```ts
const unsubscribe = map.addStyleChangeHandler({
    onStyleAboutToChange: (context) => {
        // Before the style change — clean up layers, save state
    },
    onStyleChanged: (context) => {
        // After the new style is fully loaded — restore layers, update UI
        if (context.resetState) return; // a clean switch: leave the map bare
    },
});

// When the handler's owner is torn down:
unsubscribe();
```

### Preserve custom MapLibre layers across style switches

For GeoJSON, skip this and use `CustomGeoJSONModule` (`custom.md`): it restores sources, layers, their `beforeLayerConfig` placement, images and data with no handler. Sources/layers added via `map.mapLibreMap` (tile overlays, or GeoJSON you chose to add raw) are wiped when the style changes — save and restore them:

```ts
import type { GeoJSONSource } from 'maplibre-gl';

let savedData: GeoJSON.FeatureCollection | null = null;

map.addStyleChangeHandler({
    onStyleAboutToChange: () => {
        const source = map.mapLibreMap.getSource('my-data') as GeoJSONSource | undefined;
        if (source) {
            savedData = source._data as GeoJSON.FeatureCollection;
            map.mapLibreMap.removeLayer('my-layer');
            map.mapLibreMap.removeSource('my-data');
        }
    },
    onStyleChanged: () => {
        if (!savedData) return;
        map.mapLibreMap.addSource('my-data', { type: 'geojson', data: savedData });
        map.mapLibreMap.addLayer({
            id: 'my-layer',
            type: 'circle',
            source: 'my-data',
            paint: { 'circle-radius': 6, 'circle-color': '#007cbf' },
        });
    },
});
```

Re-add with the same `beforeId` anchor — `mapStyleLayerIDs` values exist under the same IDs in every standard style, so the stacking is preserved (`mapStyleLayerIDs.lowestLabel` for lines and polygons; see `maplibre.md`).

`resetState` governs the SDK modules, not your own layers. If your app also does clean switches, read `context.resetState` in `onStyleChanged` and drop the saved data instead of re-adding it — otherwise your layers survive a reset that cleared everything else.

### Sync UI to the active style (e.g. dark-mode class)

```ts
map.addStyleChangeHandler({
    onStyleChanged: () => {
        document.body.classList.toggle('dark-mode', map.styleLightDarkTheme === 'dark');
    },
});
```

### Async handlers

Both callbacks may be `async`. `onStyleAboutToChange` handlers finish before MapLibre receives the new style; the `setStyle` promise resolves after the last `onStyleChanged` handler:

```ts
map.addStyleChangeHandler({
    onStyleAboutToChange: async () => { await saveState(); },
    onStyleChanged:       async () => { await restoreState(); },
});
await map.setStyle('streetDark'); // both have run
```

---

## Style switcher UI

```ts
const select = document.querySelector('#style-select') as HTMLSelectElement;
standardStyleIDs.forEach(id => select.add(new Option(id, id)));
select.addEventListener('change', () =>
    map.setStyle(select.value as StandardStyleID)
);
```

---

## Gotchas

- `addStyleChangeHandler` only fires for `map.setStyle()` calls — **not** on initial map construction.
- For lower-level style lifecycle hooks (initial load, any style-related event), use `map.mapLibreMap.on('styledata', ...)` — see [MapLibre MapEventType](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/MapEventType/).
- Handlers fire for a clean switch as well as for one that carries state over; read `context.resetState` to tell them apart. SDK modules reset to defaults on `true` and restore on `false`.
- Handlers run by ascending `priority`, then registration order: a default-priority handler registered before a module is created runs before that module restores, and every default one runs before the style knobs re-apply (`90`). A failing handler is caught and logged but does not block the rest.
- `map.styleLightDarkTheme` follows from the standard style ID, so it is up to date as soon as `setStyle` is called: `streetSatellite` and the `*Dark*` styles read `'dark'`, the others `'light'`.
- Calling `map.mapLibreMap.setStyle(...)` with a style of your own bypasses the SDK: its modules, knobs and style-change handlers expect a standard style and do not support it.
