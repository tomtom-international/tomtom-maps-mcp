# GL Surfaces Reference (Landmarks 3D plugin)

Textures the standard styles' water, land cover, built-up ground and roads with WebGL materials, in the style's own colours, and grows **3D trees** on woods, parks and meadows: waves that move with the wind, mirror the sky and roll in onto open shores, glaciers with crevasses, sunlit tree crowns over forests, mown lawns and flowered meadows, bushes over scrub, field parcels over farmland, laid along the roads and tracks among them (from zoom 11), dunes, mud flats, shingle, bare rock, paving, built-up ground, and smooth asphalt, softly streaked along each road, with wheel paths up close (from zoom 15). Every part is coloured for a season (`season`). It draws **inside** the style, right after the layers it textures, so labels, bridges, buildings and your own layers above stay on top; the trees draw just below the labels.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — `GLSurfaces` ships in the Landmarks 3D plugin, `@tomtom-org/maps-sdk-plugin-landmarks-3d` ([landmarks-3d.md](landmarks-3d.md)), and draws with Three.js, through the renderer the plugin's landmarks and buildings share: `three` is needed for the surfaces alone too.

Guide: [GL surfaces](https://docs.tomtom.com/maps-sdk-js/guides/plugins/landmarks-3d-gl-surfaces.md).

```bash
npm install @tomtom-org/maps-sdk-plugin-landmarks-3d   # peers: @tomtom-org/maps-sdk, maplibre-gl, three
```

## Imports

```ts
import {
    GLSurfaces,
    type GLSurfacesConfig,        // the knobs set, nested along their ids ({ wind: { speedFactor } })
} from '@tomtom-org/maps-sdk-plugin-landmarks-3d';
// the catalogue and its value lists: static data, importing nothing from three.js
import {
    glSurfacesKnobCatalogue,
    glSurfacesKnobIds,
    surfaceKinds,                 // ['water', 'ice', 'forest', 'grass', 'scrub', 'farmland', 'sand', 'mud', 'gravel', 'rock', 'paving', 'urban', 'roads']
    surfaceSeasons,               // ['spring', 'summer', 'autumn', 'winter', 'snow']
    type GLSurfacesKnob,          // one catalogue entry
    type GLSurfacesKnobId,
    type GLSurfacesKnobValueOf,
    type SurfaceKind,
    type SurfaceSeason,
} from '@tomtom-org/maps-sdk-plugin-landmarks-3d/knobs';
```

## Setup

```ts
const map = new TomTomMap({ mapLibre: { container: 'map', center: [6.6323, 46.507], zoom: 14.5, pitch: 70 } });
const surfaces = new GLSurfaces(map);                                   // every knob at its default
// or: new GLSurfaces(map, { wind: { speedFactor: 0 } });               // still water, grass and trees
```

- Starts drawing once the map is ready, and comes back after `setStyle` in the new style's colours. No `preserveDrawingBuffer` needed.
- **Needs WebGL2**: on a WebGL1 context its layers throw `GLSurfaces needs WebGL2.`
- **Follows 3D terrain** (`TerrainModule` elevation on): the textures draw on the raised ground and the trees stand on it, both hidden behind the ridges in front of them. Nothing to configure.
- On `streetSatellite` it textures the water and the roads and grows the trees, keyed from the street style's layers, each tree in the colours of the crowns the imagery shows under it.
- **Where the trees go**: under `mapStyleLayerIDs.lowestLabel`, and under every module or app layer right below it (routes, places, geometries), whichever came first. `new GLSurfaces(map, { beforeLayerConfig: 'lowest3D' })` moves them, `'top'` included, as the modules' `beforeLayerConfig` does, falling back as theirs to the top, or to the POIs for a missing `lowest3D`; it is not a knob (not in the catalogue). The textures always draw right after the layers they texture.
- A style of your own is textured only where it keeps the standard styles' layer ids and properties.

## Set / get / reset

Same rules as a map module. Values held as data (a panel, storage, an LLM) go through the SDK's knob functions by id. Typed values your code writes go through the config methods; `updateConfig` **replaces each part it names** (`updateConfig({ wind: { direction } })` drops `wind.speedFactor`). Every surface sits in the one part `surfaces`, so `updateConfig({ surfaces: { roads: { intensity: 0 } } })` also **unsets every other surface's knobs** set before; change one surface with `setKnob`/`setKnobs` instead.

```ts
import { getKnob, resetKnob, setKnob, setKnobs } from '@tomtom-org/maps-sdk/map';

setKnob(surfaces, glSurfacesKnobCatalogue, 'surfaces.roads.intensity', 0);                  // flat roads
setKnobs(surfaces, glSurfacesKnobCatalogue, { 'light.direction': 260, 'light.altitude': 12 }); // a low evening sun
surfaces.updateConfig({ wind: { direction: 270, speedFactor: 2 } });                        // a brisk westerly

getKnob(surfaces, glSurfacesKnobCatalogue, 'sky.color'); // value in force: the map's sky, or the theme's, while unset
resetKnob(surfaces, glSurfacesKnobCatalogue, 'sky.color');
surfaces.setVisible(false);  // the `visible` knob; hidden, the map draws as without the plugin
surfaces.resetConfig();      // every knob to its default
surfaces.getConfig();        // overridden knobs only, plain JSON
surfaces.remove();           // off the map for good: its layers, their WebGL resources, its style listeners
```

`setKnob` and `setKnobs` check every value first: a refused value throws `RangeError`, an unknown id `Error`. The constructor, `applyConfig` and `updateConfig` check nothing at run time.

## Seasons and colours

`season` colours every part for a season, each from the style's own colours (so `StylingFoundationsModule`'s `colors.*` knobs carry through). A part's own `*.season` overrides it for that part; a `*.colors.<role>` knob replaces that one shade whatever the season.

```ts
surfaces.updateConfig({ season: 'winter' });                                               // every part
setKnob(surfaces, glSurfacesKnobCatalogue, 'trees.season', 'autumn');                     // the trees alone
setKnob(surfaces, glSurfacesKnobCatalogue, 'surfaces.farmland.colors.rapeseed', '#f2d43a'); // one shade
getKnob(surfaces, glSurfacesKnobCatalogue, 'surfaces.grass.colors.lush'); // unset: the style's colour as the season shades it
```

- The seasons, as `surfaceSeasons` lists them: `spring`, `summer` (the default), `autumn`, `winter`, `snow`.
- Unset colour knobs report `undefined` where the style has no colour to shade (satellite).
- `snow` covers the land and the trees and hides the patterns under it; the water stays open, a colder blue.
- `autumn`, and `spring` a little, vary the foliage tree by tree.
- **Five kinds of tree**, in a mix each kind of ground and where it lies decide: broadleaf, conifers (few in the tropics, more towards the poles, and on 3D terrain taking over as the ground climbs, the trees thinning and shrinking towards a treeline about 1900 m high in the Alps), bushes (scrub, heath), columnar trees such as poplars and cypresses (cemeteries, gardens) and umbrella trees such as stone pines (only south of about 46°). `trees.species.<kind>.shareFactor` scales one kind; the columnar trees take the broadleaf colour, the umbrella trees the conifer one.
- **Roads, paths, railways and streams** through a wood keep the crowns off them, and `trees.tracks.intensity` draws them over the crowns standing in front of them in a tilted view; 0 leaves them hidden there.

## One light with the 3D buildings

`light.direction` / `light.altitude` unset **follow the map's light** (`getMapLight(map)`, set by `StylingFoundationsModule`'s `view.light.*`, `setLight` or a style's light), read every frame. `Buildings3D` (landmarks-3d) follows the same light, so set the light **once on the map**, not on each plugin:

```ts
import { StylingFoundationsModule } from '@tomtom-org/maps-sdk/map';
import { Buildings3D } from '@tomtom-org/maps-sdk-plugin-landmarks-3d';

const buildings = new Buildings3D(map);
await StylingFoundationsModule.get(map, { view: { light: { direction: 260, altitude: 20, alignment: 'map' } } });
```

- With `Buildings3D` on the same map, the tree crowns also **receive the buildings' shadows**, as dark as its `shadows.intensity` and none while its `shadows.visible` is off. Only under one sun, which they share by default: the map's light once placed, otherwise the theme's or the satellite day sun. Where the two plugins' suns lie more than 4° apart (their own `light.*` knobs, or a `Buildings3D` `preset` of another theme), the trees leave the buildings' shadows out. The 4° is the angle between the two sun directions, which `light.direction` and `light.altitude` set together. Nothing to set on `GLSurfaces`. The trees cast no shadows onto the buildings.
- `alignment: 'map'` keeps a compass direction as the map rotates; the default `'viewport'` turns the light with the map.
- The standard styles place no light: until one is set, light styles get 215 / 30 and dark ones 135 / 35, `Buildings3D`'s day and night presets. On `streetSatellite`, which `map.styleLightDarkTheme` counts as dark, the surfaces take `Buildings3D`'s satellite day sun, 215 / 35, and a day sky.
- A plugin's own `light.direction` / `light.altitude` knob wins over the map's light, for that plugin only. A map light below 5° is drawn at 5°.

## Knob ids

| Group | Ids | Range | Default |
| --- | --- | --- | --- |
| visibility | `visible` | boolean | `true` |
| season | `season` | `spring` / `summer` / `autumn` / `winter` / `snow` | `summer` |
| season per part | `surfaces.water.season`, `surfaces.ice.season`, `surfaces.forest.season`, `surfaces.grass.season`, `surfaces.scrub.season`, `surfaces.farmland.season`, `surfaces.sand.season`, `surfaces.mud.season`, `surfaces.gravel.season`, `surfaces.rock.season`, `surfaces.paving.season`, `surfaces.urban.season`, `surfaces.roads.season`, `trees.season` | a season | `season` |
| shade colours | `surfaces.water.colors.shallow`, `surfaces.water.colors.foam`, `surfaces.forest.colors.broadleaf`, `surfaces.forest.colors.conifer`, `surfaces.grass.colors.lush`, `surfaces.grass.colors.dry`, `surfaces.grass.colors.flowers`, `surfaces.farmland.colors.young`, `surfaces.farmland.colors.cereal`, `surfaces.farmland.colors.soil`, `surfaces.farmland.colors.pasture`, `surfaces.farmland.colors.rapeseed`, `surfaces.farmland.colors.stubble`, `surfaces.farmland.colors.hedges`, `surfaces.sand.colors.wet`, `surfaces.ice.colors.crevasses`, `surfaces.scrub.colors.bushes`, `surfaces.mud.colors.wet`, `surfaces.paving.colors.joints`, `trees.colors.broadleaf`, `trees.colors.conifer` | colour | the style's colour, shaded for the season |
| surfaces | `surfaces.water.intensity`, `surfaces.ice.intensity`, `surfaces.forest.intensity`, `surfaces.grass.intensity`, `surfaces.scrub.intensity`, `surfaces.farmland.intensity`, `surfaces.sand.intensity`, `surfaces.mud.intensity`, `surfaces.gravel.intensity`, `surfaces.rock.intensity`, `surfaces.paving.intensity`, `surfaces.urban.intensity`, `surfaces.roads.intensity` | 0 (style's flat colour) – 1 | 1, 0.8, 0.9, 0.8, 0.8, 0.9, 0.8, 0.8, 0.8, 0.8, 0.7, 0.5, 0.7 |
| water | `surfaces.water.reflection.intensity`, `surfaces.water.glint.intensity`, `surfaces.water.shore.intensity` | 0–1 | 1 |
| waves | `surfaces.water.waves.heightFactor` (open water) / `surfaces.water.enclosed.waves.heightFactor` (canals, ponds, harbours; times the open water's) | 0–3 / 0–1 | 1 / 0.3 |
| shore | `surfaces.water.shore.reachMeters` (how far out the waves turn fully to roll in onto an open shore, leaning towards the shores around them farther out; the land field builds from zoom 12.5) | 0–400 m | 160 |
| forest | `surfaces.forest.crowns.sizeFactor` (× ~8 m) / `surfaces.forest.conifer.fraction` | 0.5–2 / 0–1 | 1 / 0.38 |
| grass | `surfaces.grass.mown.fraction` / `surfaces.grass.stripes.intensity` / `surfaces.grass.flowers.fraction` | 0–1 / 0–1 / 0–0.2 | 0.5 / 0.5 / 0.02 |
| farmland | `surfaces.farmland.parcels.sizeFactor` (× 35–125 m) / `surfaces.farmland.rows.intensity` / `surfaces.farmland.hedges.intensity` | 0.5–3 / 0–1 / 0–1 | 1 / 0.5 / 0.85 |
| sand | `surfaces.sand.dunes.intensity` / `surfaces.sand.ripples.intensity` / `surfaces.sand.wet.widthMeters` | 0–1 / 0–1 / 0–12 m | 0.5 / 0.5 / 4 |
| ice, scrub, mud, gravel | `surfaces.ice.crevasses.intensity` / `surfaces.scrub.bushes.intensity` / `surfaces.mud.puddles.intensity` / `surfaces.gravel.stones.intensity` | 0–1 | 0.5 / 0.7 / 0.5 / 0.5 |
| rock, paving, urban, roads | `surfaces.rock.ridges.intensity` / `surfaces.paving.joints.intensity` / `surfaces.urban.wear.intensity` / `surfaces.roads.wear.intensity` | 0–1 | 0.5 |
| trees | `trees.visible` / `trees.densityFactor` / `trees.sizeFactor` / `trees.minZoom` / `trees.shadows.intensity` / `trees.tracks.intensity` | boolean / 0–3 / 0.5–2 / 13–19 / 0–1 / 0–1 | `true` / 1 / 1 / 15 / 0.55 / 0.6 |
| tree mix | `trees.species.broadleaf.shareFactor`, `trees.species.conifer.shareFactor`, `trees.species.columnar.shareFactor`, `trees.species.umbrella.shareFactor`, `trees.species.bush.shareFactor` | 0–3, times the share the ground and latitude give that kind; 0 for none, the others fill in | 1 |
| light | `light.direction` / `light.altitude` | 0–359° from north / 5–90° | the map's light, else 215 / 30 on light styles, 135 / 35 on dark, 215 / 35 on `streetSatellite` |
| glint colour | `surfaces.water.glint.color` | colour | sunlight on light styles and `streetSatellite`, moonlight on other dark styles |
| sky | `sky.color`, `sky.horizonColor` (what the water mirrors) | colour | the map's sky, else a day or night sky by `map.styleLightDarkTheme`, and a day sky on `streetSatellite` |
| wind | `wind.direction` (blows **from**) / `wind.speedFactor` | 0–359° / 0–4 (hard minimum 0) | 225 / 1 |

`glSurfacesKnobCatalogue` carries each knob's kind, range, default and description, for building controls; `glSurfacesKnobIds` lists the ids.

## What each surface textures

| Surface | Style layers and classes |
| --- | --- |
| `water` | `Water - Fill` and `Water - Shadow` except glaciers, `Water - Line` except where it runs dry |
| `ice` | glaciers of `Water - Fill`, `LULC - Earth Cover` ice and snow (to zoom 12) |
| `forest` | `LULC - Landcover` woodland, `LULC - Earth Cover` woody (to zoom 12) |
| `grass` | `LULC - Landcover` grassland, `LULC - Landuse` outdoor and sport groups, cemeteries and campsites, `LULC - Outdoor & Sport`, `LULC - Earth Cover` herbaceous (to zoom 12) |
| `scrub` | `LULC - Landcover` shrubland |
| `farmland` | `LULC - Landcover` agricultural, `LULC - Earth Cover` cropland (to zoom 12) |
| `sand` | `LULC - Landcover` sandy, `LULC - Earth Cover` sand (to zoom 12) |
| `mud` | `LULC - Landcover` bareland mud, `Water - Intermittent`, `Water - Line` where it runs dry |
| `gravel` | `LULC - Landcover` bareland shingle |
| `rock` | the rest of `LULC - Landcover` bareland, the breakwaters and groynes of `Structure - Bridge & Pier *` |
| `paving` | `Areas - Pedestrian *`, `Transit - Platform *`, the piers and bridges of `Structure - Bridge & Pier *` |
| `urban` | `LULC - Built-up area`, `LULC - Landuse` but its outdoor and sport groups, cemeteries and campsites |
| `roads` | the eight `Surface - *` road layers, whose lanes it follows; `LULC - Parking & Driving`, `Areas - Service road`, `Transit - Aeroway *` |
| none | `LULC - Protected Areas` and `Hillshade` only tint what lies under them, so they stay untextured |
| 3D trees | woods, parks, gardens, meadows, scrub, heaths, orchards (in rows), cemeteries and playgrounds from `LULC - *`, each at its own density; on satellite, stand-ins of the same layers |

## Gotchas

- **Motion costs frames**: while water, grass or trees (from zoom 16) show and `wind.speedFactor > 0`, the map redraws every display frame. Set `wind.speedFactor` to 0 to let it rest, and do so under `matchMedia('(prefers-reduced-motion: reduce)')`.
- It adds `gl-surfaces-*` layers to the style (a snapshot, mask copies of the textured layers, a composite). Don't remove or move them; `setVisible(false)` hides them, and `remove()` takes them off (create a new `GLSurfaces` to show them again).
- Recolouring the textured layers (`setMapColors`, `setPaintProperty`) carries through: the materials vary the colour drawn there rather than replace it.
- The sky is read, never written: set `sky.color` here to change what the water mirrors without changing the map's sky.
