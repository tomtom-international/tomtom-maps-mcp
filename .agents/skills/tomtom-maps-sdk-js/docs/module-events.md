# Module Lifecycle Events Reference

## Imports

```ts
import { PlacesModule, RoutingModule, TerrainModule, type PlacesModuleSerializableConfig } from '@tomtom-org/maps-sdk/map';
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
```

---

## Two event types

| Event | Fires when | Available on |
|-------|-----------|-------------|
| `config-change` | Any config mutation (see triggers below) | Every module, `TerrainModule` and `StylingFoundationsModule` included |
| `shown-features` | After any of a module's `show*()` calls drew its data | PlacesModule, RoutingModule, GeometriesModule, ReachableRangesModule, CustomGeoJSONModule, TrafficIncidentDetailsModule, TrafficAreaAnalyticsModule |

Both live on `module.events`, beside the user events (`user-events.md`), never on a named scope: `routing.events.tunnels.on('click', …)` works, `routing.events.tunnels.on('config-change', …)` does not.

---

## `config-change`

```ts
const terrain = await TerrainModule.get(map);
const unsub = terrain.events.on('config-change', (config) => {
    toggleEl.checked = config?.hillshade?.visible ?? false; // whole config, as getConfig() returns it; may be undefined after resetConfig()
});
unsub();
```

Triggers: `applyConfig`, `updateConfig`, `resetConfig` (what each does: `map-setup.md` § Changing a setting), `setKnob`, `setKnobs` (one event for all its values), `resetKnob`, `setVisible` (BaseMap's with `{ layerGroups }` too), Traffic Incidents' `setIconsVisible`, Terrain's `setHillshadeVisible` / `setElevationVisible`, Area Analytics' `setPalette` / `setColorStops` / `setHeight` / `setFilters`, `get(map, config)` on a style-owned module the map already has (replaces its config; `StylingFoundationsModule` merges it), and `setStyle(…, { resetState: true })`. **Not** the config given at `create()` / the first `get()`.

### Saving and replaying a configuration

`JSON.parse(JSON.stringify(module.getConfig()))` given back to `applyConfig` holds the same configuration and draws the same layers. Every module's configuration is JSON whole except six, which also take functions or image elements; each has a `*SerializableConfig` type for the part JSON carries:

```ts
places.events.on('config-change', (config) => localStorage.setItem('places', JSON.stringify(config)));

const state: PlacesModuleSerializableConfig = JSON.parse(localStorage.getItem('places')!);
places.applyConfig({ ...state, extraFeatureProps: { ...state.extraFeatureProps, rank: rankPlace } }); // add code back
```

`applyConfig` checks nothing at run time. For saved settings your own `getConfig()` didn't write (an older release, a user's edit, a shared URL), save knob values by id and restore them with `setKnobs(module, catalogue, values)`, which refuses them all if one is out of range (`map-setup.md` § Changing a setting).

| Type | Left out (add back in code on replay) |
|------|------|
| `PlacesModuleSerializableConfig` | `label.title` function (an expression serializes), `connections.label.title`, `icon.mapping`, `extraFeatureProps` functions, `HTMLImageElement` in `icon.default` / `icon.categoryIcons` |
| `RoutingModuleSerializableConfig` | `waypoints.icon.mapping`, `waypoints.label.title` function, `HTMLImageElement` in `waypoints.icon.customIcons` and each waypoint role's `image` |
| `GeometriesModuleSerializableConfig` | `transformFeaturesForDisplay` |
| `ReachableRangesModuleSerializableConfig` | `lineLabel.title` |
| `CustomGeoJSONModuleSerializableConfig` | `images` (no image payload survives JSON) |
| `POIsModuleSerializableConfig` | `HTMLImageElement` in `icon.categoryIcons` |

- `SerializableCustomImage` is a `CustomImage` whose `image` is a string, `SerializablePinIconConfig` a pin whose `image` is one, `SerializableFeatureLabelConfig` a label whose `title` is a MapLibre expression.
- `JSON.stringify` silently drops functions but turns an `HTMLImageElement` into `{}`, which breaks the replay — use URLs, data URIs or SVG text for icons.
- The configuration does not include shown data: call `show()` again.

---

## `shown-features`

One stream per module; with several show methods the payload says which ran:

```ts
// PlacesModule — { places } from show(), { connections } from showConnections()
places.events.on('shown-features', (features) => {
    if ('places' in features) fitMapToResults(features.places);
});

// RoutingModule — { routes } from showRoutes(), { waypoints } from showWaypoints()
routing.events.on('shown-features', (features) => {
    if ('routes' in features) updateSummary(features.routes);
});

// CustomGeoJSONModule — { sourceName, data }; a show() without a source name fires once per source
custom.events.on('shown-features', ({ sourceName, data }) => updatePanel(sourceName, data));

// GeometriesModule / ReachableRangesModule — the PolygonFeatures given
geometries.events.on('shown-features', (features) => {
    const bbox = bboxFromGeoJSON(features);
    if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 40 });
});

// TrafficIncidentDetailsModule — TrafficIncidentDetails; TrafficAreaAnalyticsModule — TrafficAreaAnalytics
```

- Fires once the data is on the map, before the `show()` promise resolves — `module.getShown()` already returns it.
- `TrafficFlowModule`, `TrafficIncidentsModule`, `TerrainModule`, `BaseMapModule`, `POIsModule`, `StylingFoundationsModule` have no `show()`: neither `events.on('shown-features', …)` nor `events.off('shown-features')` compiles on them.

---

## Unsubscribe

```ts
const unsubA = places.events.on('config-change', handlerA); // on() always returns () => void
const unsubB = places.events.on('config-change', handlerB);
unsubA();                              // only handlerA
places.events.off('config-change');    // every config-change handler; off() takes user event types too
```

Named scopes and `events.where`: `user-events.md` → Named scopes, Scoping events.
