# Map Styling Reference (StylingFoundationsModule)

Semantic restyling of the map's foundations — label, icon and road sizes, the label typeface, the map colours, projection and sky — through **knobs** with stable ids, each reaching across the whole style. Prefer this over `map.mapLibreMap.setPaintProperty(...)` on base-map layers: knobs are validated by `setKnob` and `setMapColors` (not by `applyConfig` / `updateConfig`, see `map-setup.md` § Changing a setting), listed as data in a catalogue (as every module's settings are), re-applied across `setStyle`, and re-verified by the SDK against the styles it ships with — raw layer ids are not a contract.

The look of one part is the knobs of the module drawing it, set with the same `setKnob`: POI size, density and label colours on `POIsModule` (`places.md`), the traffic colours and widths on `TrafficFlowModule` / `TrafficIncidentsModule` (`traffic.md`), the hillshade on `TerrainModule` and the road markings on `BaseMapModule` (`map-setup.md`). Map presets set knobs across this module, `BaseMapModule` and `POIsModule` at once (§ Presets).

## Imports

```ts
import {
    StylingFoundationsModule,
    type StylingFoundationsKnobId,
    type StylingFoundationsKnob,
    type StylingFoundationsModuleConfig,
    type StyleColorKnobId,
    type MapColors,
    type MapPresetId,
    type MapTypeface,
    type CustomTypeface,
    type CustomTypefaceFile,
    mapTypefaces,
    stylingFoundationsKnobIds,
    styleColorKnobIds,
    stylingFoundationsKnobCatalogue,
    mapColorNames,
    baseMapColorNames,
    type BaseMapColorName,
    getKnob,
    resetKnob,
    setKnob,
    setKnobs,
    getStyleColor,
    applyMapPreset,
    mapPresetCatalogue,
    mapPresetIds,
} from '@tomtom-org/maps-sdk/map';
```

## Setup

```ts
const styling = await StylingFoundationsModule.get(map);                       // one per map: get() again returns it
const styling = await StylingFoundationsModule.get(map, { labels: { sizeFactor: 1.2 } }); // nested along the knob id; merged one level deep over what it holds
```

`get` resolves after the style loads and before its first frame; knobs set by then (passed to `get`, or `setMapColors` right after it) land on that frame without fading in from the style's own colours. Theme at startup this way: no hidden container or delay needed (`examples/themed-map`).

## setKnob / setKnobs / getKnob / resetKnob

The same functions as on every module (`map-setup.md` § Every setting as data); a styling id is the setting's path in `StylingFoundationsModuleConfig`, `'colors.water'` being `{ colors: { water } }`. Use them for values held as data (a panel, storage, an LLM): they check each value. `applyConfig`/`updateConfig` are for typed settings your code writes, check nothing at run time, and `updateConfig({ colors: { water } })` **replaces** every colour set before (`map-setup.md` § Changing a setting).

```ts
setKnob(styling, stylingFoundationsKnobCatalogue, 'labels.sizeFactor', 1.3);            // factor 0.5–1.5, 1 = as the style ships
setKnob(styling, stylingFoundationsKnobCatalogue, 'symbols.sizeFactor', 1.2);           // icons: POI icons, shields, arrows
setKnob(styling, stylingFoundationsKnobCatalogue, 'roads.widthFactor', 0.8);            // road hierarchy kept
setKnob(styling, stylingFoundationsKnobCatalogue, 'colors.water', '#7cc4e8');           // hex, rgb(), hsl() or a named colour
setKnob(styling, stylingFoundationsKnobCatalogue, 'view.projection', 'globe');          // enum
setKnobs(styling, stylingFoundationsKnobCatalogue, { 'colors.land': '#f6efe3', 'colors.roadMajor': '#d9822b' }); // several: one restyle, all or none

getKnob(styling, stylingFoundationsKnobCatalogue, 'roads.widthFactor');   // current value, or the style default
resetKnob(styling, stylingFoundationsKnobCatalogue, 'roads.widthFactor'); // one knob back to the style
styling.resetConfig();                                         // every knob back to the style
```

Invalid values throw `RangeError` naming the knob and its range; unknown ids throw `Error`. Nothing is touched on a failed call.

## Knob ids

| Group | Ids | Kind |
| --- | --- | --- |
| Labels & symbols | `labels.sizeFactor`, `symbols.sizeFactor` | factor 0.5–1.5 |
| | `labels.typeface` (`'sans'` \| `'sans-italic'` \| `'serif'` \| `'serif-italic'`, § Typeface) | enum |
| Roads | `roads.widthFactor` | factor 0.5–1.5 |
| Map colours | `colors.land`, `colors.water`, `colors.vegetation`, `colors.park`, `colors.artificial`, `colors.roadMajor`, `colors.road`, `colors.roadOutline`, `colors.label`, `colors.labelHalo`, `colors.accent` (see `setMapColors`) | color |
| View | `view.projection` (`'mercator'` \| `'globe'`) | enum |
| | `view.sky.visible` | toggle |
| | `view.sky.color`, `view.sky.horizonColor`, `view.space.color` | color |
| Light (3D buildings) | `view.light.direction` (0–359°), `view.light.altitude` (0–90°), `view.light.intensity` (0–1) | number |
| | `view.light.alignment` (`'viewport'` \| `'map'`) | enum |
| | `view.light.color` | color |
| 3D buildings | `buildings3D.roundedCornerDistanceMeters` (metres, ≥ 0) | number |

Road widths are in pixels and stop growing at zoom 19, and `roads.widthFactor` scales every zoom alike. To draw roads at their real width (a true-size vehicle at zoom 19 and up), add your own lines with `CustomGeoJSONModule` (`custom.md`) whose `line-width` converts metres to pixels and doubles per zoom level: `['interpolate', ['exponential', 2], ['zoom'], 0, metres / metresPerPixelZ0, 24, metres * 2 ** 24 / metresPerPixelZ0]`, with `metresPerPixelZ0 = 40075016.686 * Math.cos(latitude * Math.PI / 180) / 512`.

**No knob here shows or hides a part of the map** — water, railways, 2D/3D buildings, road shields, label groups and the road markings within them are `BaseMapModule` (`baseMap.setVisible(visible, { layerGroups: { show: 'only', values: ['buildings3D'] } })`, or `setKnob(baseMap, baseMapKnobCatalogue, 'groups.buildings3D.visible', true)`; `map-setup.md`).

| Part | Module | Look knobs |
| --- | --- | --- |
| POIs | `POIsModule` (`places.md`) | `sizeFactor`, `minZoom`, `zoomShift`, `label.color`, `label.haloColor`, `microMarkers.visible` |
| Traffic flow | `TrafficFlowModule` (`traffic.md`) | `colors.<level>`, `widthFactor`, `opacityFactor` |
| Traffic incidents | `TrafficIncidentsModule` (`traffic.md`) | `colors.<magnitude>`, `widthFactor`, `opacityFactor` |
| Hillshade | `TerrainModule` (`map-setup.md` § TerrainModule) | `hillshade.*` |
| Road markings | `BaseMapModule` (`map-setup.md`) | a `visible` per road part: `exitNumbers`, `arrows`, `restricted`, `underConstruction` |

All of them restyle the loaded style through one engine per map: factors on one layer property multiply whichever module set them (`labels.sizeFactor` here × `POIsModule`'s `sizeFactor` on POI labels), and every value lands again after `setStyle`.

`stylingFoundationsKnobIds` lists this module's ids, as a constant needing no module. Colours are named **map-wide**: a module's catalogue id under its prefix — none for this module, `pois.`, `traffic.flow.`, `traffic.incidents.`, `terrain.` — and `styleColorKnobIds` (type `StyleColorKnobId`) lists every colour id; `StyleKnobId` / `StyleKnobValueOf<ID>` type every look knob that way. `getStyleColor(map, id)` reads the colour in force, set or the style's own, whether or not the owning module exists:

```ts
getStyleColor(map, 'colors.water');                      // the water colour in force, a CSS colour string
getStyleColor(map, 'traffic.incidents.colors.major');    // undefined where the style colours it by an expression
```

Name a map colour through these ids rather than hard-coding it (the map-effects plugin's `bloom.only` takes them).

### Typeface

Every map label in one typeface, each keeping its weight (bold stays bold) and slant. Two ways, and the second wins while set:

```ts
setKnob(styling, stylingFoundationsKnobCatalogue, 'labels.typeface', 'serif'); // the Noto faces the TomTom styles serve; `mapTypefaces` lists the ids

// Your own font files (WOFF2/TTF URLs, self-hosted or a font CDN; the SDK bundles none). Not a knob: config only.
// `updateConfig` replaces `labels` whole: spread the rest of it on every set and unset, or labels.sizeFactor/typeface go
const fraunces = 'https://cdn.jsdelivr.net/fontsource/fonts/fraunces@5/latin';
styling.updateConfig({ labels: { ...styling.getConfig()?.labels, customTypeface: {
    regular: `${fraunces}-400-normal.woff2`,          // required; a missing weight takes the nearest one given
    bold: `${fraunces}-700-normal.woff2`,
    regularItalic: `${fraunces}-400-italic.woff2`,    // a missing italic takes the nearest italic given, else the upright file
} } });
styling.updateConfig({ labels: { ...styling.getConfig()?.labels, customTypeface: undefined } }); // unset the files alone
```

- `CustomTypeface` takes `regular`, `medium`, `bold`, `regularItalic`, `mediumItalic`, `boldItalic`, each a URL or a `CustomTypefaceFile[]` (`{ url, unicodeRange }`) for a weight split into files by script (a CDN's `latin` + `latin-ext`).
- A plain URL draws the characters in `unicodeRange`, by default the `latin` subset Fontsource and Google Fonts serve (Basic Latin, Latin-1, punctuation). Every other character, and every character of a file that fails to load, comes from the style's Noto face of that weight, so Cyrillic or CJK names still show. A character inside the range that the file lacks falls to the browser's sans-serif: list only what the files have. Keep Arabic and Indic scripts outside the range (drawn one cluster at a time, letters don't join).
- The serif and italic Noto faces lack some scripts (serif: no Arabic; italics: Latin, Greek, Cyrillic only); the style's own face draws those.
- Kept in `getConfig()` and re-declared after `setStyle`; a clean switch drops it.
- **The SDK's own labels follow** (route waypoints and summary bubbles, places, geometry titles and border labels, reachable ranges, incident details) unless their module sets one of its own.
- **A module's own typeface** goes on its label settings, the same two fields as the map's `labels`: `typeface` (a knob: `RoutingModule`'s `waypoints.label.typeface` and `summaryBubbles.label.typeface`, `PlacesModule`'s `label.typeface`, `GeometriesModule`'s `label.typeface` and `lineLabel.typeface`, `ReachableRangesModule`'s `lineLabel.typeface`) and `customTypeface` (font files, config only, wins over `typeface`). It sets those labels only; unset, they follow the map's again, files included. The module re-declares its files after `setStyle`.
  ```ts
  await PlacesModule.create(map, { label: { customTypeface: { regular: `${fraunces}-400-normal.woff2` } } });
  setKnob(routing, routingKnobCatalogue, 'waypoints.label.typeface', 'serif-italic');
  ```
- Per label, the order is `font` (exact `mapFonts` faces, or a raw `text-font` under `layers`), then `customTypeface`, then `typeface`, then the map's. Live demo: the `map-typeface` example.

### Borrowed looks

Knobs write only style layers, but some module parts read their look off the style and follow the knobs that restyle it — live, set before or after the module was created, and across `setStyle`. A setting given to the module wins.

| Module | Borrows | Follows | Own look instead |
| --- | --- | --- | --- |
| `PlacesModule`, `base-map` | POI labels and icons | `POIsModule`'s `label.color`, `label.haloColor`, `sizeFactor`; `labels.sizeFactor`, `symbols.sizeFactor` here | `label`, `layers` |
| `PlacesModule`, `circle-icon` / `pin-clustered` | POI icon size / micro markers | `symbols.sizeFactor` here, `POIsModule`'s `sizeFactor` | `layers` |
| `RoutingModule` | `traffic` section delay colours; SDK colours while none is set | `TrafficIncidentsModule`'s `colors.minor`, `colors.moderate`, `colors.major` | `line-color` under `layers.sections.traffic.routeIncidentBackgroundLine` |
| `RoutingModule`, summary bubbles | bubble fill (the halo, lightened) and text; SDK light/dark default while none is set | `colors.labelHalo`, `colors.label` here (what a theme sets) | `summaryBubbles.color`, `summaryBubbles.label.color` |
| `RoutingModule`, border crossings | the same as the selected summary bubble | `colors.labelHalo`, `colors.label` here | `countryCrossings.color`, `countryCrossings.label.color` |
| `TrafficIncidentDetailsModule` | incident colour per magnitude | `TrafficIncidentsModule`'s `colors.minor`, `colors.moderate`, `colors.major`, `colors.closed` | none |

`pin` places borrow nothing. Live demo: the `styling-borrowed-looks` example.

## Map colours — `setMapColors(colors)`

Ten semantic colours plus `accent`, which paints no base-map layer (`map-theming.md`); `mapColorNames` lists all eleven, `baseMapColorNames` (`BaseMapColorName`) the ten without `accent` — the list a base-map colour picker iterates — and `MapColors` types the partial object. Partial objects OK: colours not given stay as drawn, except on `monoLight`/`monoDark`, which derive the other nine from `land` with the theme's formulas, so `setMapColors({ land })` alone recolours a mono map. One name recolours every layer and shade derived from it (outlines, tunnels, bridges, trunk vs motorway) by the style's own HSL offsets — coherent, not a flat fill. An unknown name throws `Error`, a non-colour value `RangeError`.

| Name | Reaches |
|---|---|
| `land` | Map background and bare land; on the mono styles, derives every colour left unset, borders and labels included |
| `water` | Waterbodies and waterways; also glaciers, water labels, ferry lines |
| `vegetation` | Forests, grass, shrubland; also earth cover at smaller scales |
| `park` | City parks and sport/recreation grounds; also National Parks and protected areas |
| `artificial` | Built-up areas, landuse grounds, buildings; also railways |
| `roadMajor` | Motorways, trunks, primary roads; also their outlines and tunnels |
| `road` | Secondary/tertiary down to streets and service roads; also their tunnels |
| `roadOutline` | Outlines of secondary/tertiary and minor roads, tunnels, bridges and link roads included; major road outlines follow `roadMajor` |
| `label` | Capital and other place/admin labels; also borders and all other label colours |
| `labelHalo` | Halos of place and admin labels; also border outlines and all other label halos |

```ts
styling.setMapColors({ land: '#f3f5f7', water: '#accbe2', roadMajor: '#a1b8ce', label: '#364659' });
getKnob(styling, stylingFoundationsKnobCatalogue, 'colors.roadMajor');   // the style's base literal until set, e.g. 'hsl(47, 100%, 55%)'
resetKnob(styling, stylingFoundationsKnobCatalogue, 'colors.roadMajor'); // the colours are the `colors.*` knobs
map.mapColors;                                                // the ten in force + accent; {} until this module exists
styling.exportStyle();                                        // StyleSpecification as rendered: knobs applied, SDK overlays included; tile URLs carry the API key
```

Prefer `setMapColors` over `setPaintProperty` on road/water/label layers: the recolour reaches ~150 layers' literals inside match/interpolate expressions and re-applies after `setStyle`. Land-use and building tints of their own hue (education, healthcare, leisure, shopping) keep that hue, follow `artificial`'s lightness, and mute or regain saturation with its luminance, as the style's theme derives them. City parks and sport grounds (the `outdoor` and `sport` land-use groups) follow `park` alone on every standard style; with `park` unset they keep the style's colour, whatever `artificial` is. A pure grey map colour gives grey shades.

A palette is a recolour, not an inversion — the offsets come off the loaded style. Keep it near that style's lightness; for a dark palette `await map.setStyle('streetDark')` first, then recolour, or the derived shades clamp and the road hierarchy washes out.

A day-to-night switch is a `setStyle` to the loaded style's dark counterpart (`streetDark`, `streetDarkDriving`, `monoDark`) and back; there is no light/dark toggle on `StylingFoundationsModule`. The dark style's icons (its sprite) and traffic colours have dark versions no map colour reaches. What the switch reloads: `map-styles.md` § Setting a style.

When the look comes as a website, an image, a described palette or an artist's style rather than ten named colours, `styling.setMapColors(deriveMapColors([...]))` with the map-theme plugin assigns the roles for you, `colors.accent` included — see `map-theming.md`.

## Globe and sky — the `view` knobs

Map-level MapLibre state a `setStyle` would reset; owned here so it survives style switches.

```ts
setKnob(styling, stylingFoundationsKnobCatalogue, 'view.projection', 'globe');
setKnob(styling, stylingFoundationsKnobCatalogue, 'view.sky.visible', true); // without it a globe has NO atmosphere (MapLibre's default sky is transparent)
map.mapLibreMap.setMaxPitch(75);                          // fog over a tilted view starts at pitch 60 = MapLibre's default maxPitch
```

3D terrain is **not** a knob — it needs the elevation style part loaded first, which `TerrainModule.get(map, { elevation: { visible: true } })` does (see `map-setup.md` § TerrainModule).

Sky colours: a set `view.sky.color` / `view.sky.horizonColor` wins; unset, they take the style's own `sky` where it declares one that draws something (a sky with transparent `sky-color` and `horizon-color` and `atmosphere-blend: 0` draws nothing, and gives way to the theme's), else follow `map.styleLightDarkTheme` — daylit blue + white horizon on a light style, night blue + dim horizon on a dark one.

The sky knobs write MapLibre's **whole** sky: a field set with `map.mapLibreMap.setSky` (`atmosphere-blend`, `sky-horizon-blend`, the fog colour and blends) goes back to the style's own value, else the SDK's default, whenever a sky knob applies — on set, on reset, and after `setStyle`. With only `view.projection` set, a hand-set sky stays until the next style switch.

`view.space.color` is the colour **behind** the map, which a globe leaves visible around the planet. The map canvas is transparent there, so something has to fill it. A background your page already gives the map container is the knob's default and what `resetKnob` returns to — the SDK does not paint over it. Otherwise it follows the theme (white on light, the night sky's `#0a1626` on dark) and is re-applied after a `setStyle`, so a light→dark switch carries it.

The `view.light` knobs set MapLibre's light, the map's one light: it shades the sides of the style's 3D buildings (`fill-extrusion`), and the plugins drawing their own lit surfaces follow it while their own light direction and altitude knobs are unset — landmarks-3d's `Buildings3D` (which hides the style's buildings and lights its own from it) and its `GLSurfaces` (tree crowns, dunes, water glint). Set the light once here to light them all alike. The standard styles ship `buildings3D` hidden, except the driving ones, so show it through `BaseMapModule` first, and tilt the camera.

```ts
await BaseMapModule.get(map, { groups: { buildings3D: { visible: true } } });
await StylingFoundationsModule.get(map, {
  view: { light: { direction: 270, altitude: 35, alignment: 'map', color: '#ffd9a8', intensity: 0.7 } },
});
```

`buildings3D.roundedCornerDistanceMeters` is MapLibre's layout `fill-extrusion-rounded-corner-distance` on the style's 3D buildings: how far along each wall a corner is rounded. Every map softens them by 1 m on every style load, unless the style sets its own; that is the knob's default and what `resetKnob` returns to. `0` for sharp corners, 2–4 for visibly rounded buildings. It changes nothing while a `Buildings3D` shows, which hides the style's buildings.

`direction` is degrees clockwise from the top of the screen, or from north with `alignment: 'map'`. `altitude` is degrees above the horizon. An unset colour, intensity or alignment takes the style's own `light`, otherwise MapLibre's default (white, `intensity` 0.5, `viewport`). Direction and altitude take 210° and 60° only once one of them is set: until then the position stays unset, so `getMapLight` stays `undefined`. The knobs write MapLibre's **whole** light, so a part set with `map.mapLibreMap.setLight` goes back whenever a light knob applies. Once a light knob has been set, a clean `setStyle(…, { resetState: true })` writes the new style's light, which MapLibre on its own would not.

To light a layer of your own from the same direction, `getMapLight(map)` returns `MapLight` `{ direction, altitude }`: the direction as a compass bearing from north **whatever the map's bearing** (a `viewport`-aligned light turns with the camera, so read it per frame), the altitude above the horizon. It returns `undefined` while the map has no light placed — on the standard styles until `view.light.direction` or `view.light.altitude` (or `setLight` with a `position`) places one. The colour, intensity and alignment knobs alone place none, and neither does a style light whose `position` is an expression.

Gotcha: the globe flattens to Mercator between zoom 11–12 by design.

## Presets — `applyMapPreset(map, id, { merge? })`

Named bundles of knob settings across the modules that hold the look: this one, `BaseMapModule`'s road parts and `POIsModule`'s look. `mapPresetCatalogue` (`MapPreset[]`) lists them with their `settings` (`MapPresetSettings`: `stylingFoundations`, `baseMap`, `pois`, each by that module's own catalogue ids); `mapPresetIds` / `MapPresetId` name them. Presets leave whole layer groups (buildings, shields) as the style ships them.

| Preset | Intent |
| --- | --- |
| `'data-viz'` | quiet base under your data: smaller labels/icons, thinner roads, no exit numbers or arrows, no micro markers, POIs from z14 |
| `'night-driving'` | bigger labels and icons, wider roads, exit numbers and arrows shown, no micro markers, POIs from z13 |
| `'minimal'` | bare map: smaller labels, no road markings (restricted-access dashes included), roads under construction, exit numbers or micro markers, POIs from z16 |
| `'globe'` | `view.projection: 'globe'` + `view.sky.visible: true` |

```ts
await applyMapPreset(map, 'data-viz');                // resets the knobs the presets set, then applies this one
await applyMapPreset(map, 'globe', { merge: true });  // lays over current settings
```

- Async: it creates the modules the map lacks (`StylingFoundationsModule`, `BaseMapModule`, `POIsModule`) — `get()` returns those same instances.
- Without `merge`, only the knobs some preset sets are reset first; your other settings stay.
- An unknown id throws `Error` listing `mapPresetIds`; `MapPresetId` is their union, `MapPreset` a catalogue entry.

Agent toolkit: `setMapStyling({ preset: 'data-viz' })`. For dimming/desaturating the base map itself, pair with the map-effects plugin (`map-effects.md`).

## The catalogue — `stylingFoundationsKnobCatalogue`

Static data, no map needed: the knob ids table above as code.

```ts
// stylingFoundationsKnobCatalogue: readonly StylingFoundationsKnob[] — { id, kind, description, range (factor, number), options (enum), appliesTo }
// kind is one of stylingFoundationsKnobKinds: 'factor' | 'number' | 'toggle' | 'color' | 'enum'
const sliders = stylingFoundationsKnobCatalogue.filter((knob) => knob.kind === 'factor' || knob.kind === 'number');
getKnob(styling, stylingFoundationsKnobCatalogue, 'roads.widthFactor'); // the value in force on a live map
```

- Entries are `KnobEntry`s, shared with every module's catalogue (`map-setup.md` § Every setting as data); no `default`, the loaded style decides.
- `getKnob(styling, stylingFoundationsKnobCatalogue, id)` returns the override, or the loaded style's own value (`undefined` when the style uses a data-driven expression — `resetKnob` still restores it).
- `appliesTo`: `'any-style'` knobs need no knowledge of the style, so they survive style-version bumps — the `*.sizeFactor` / `*.widthFactor` factors (they scale the style's own value: a zoom ramp has each stop's output scaled, any other expression is wrapped in `["*", factor, …]`), the `view.*` knobs (map-level state, no layer) and `colors.accent` (paints no layer); `'tomtom-styles'` knobs — the ten map colours — work on the TomTom styles this SDK version is verified against. On a style layer they do not recognise, setting one warns once and does nothing.

## Settings — persist / share / replay

```ts
const settings: StylingFoundationsModuleConfig | undefined = styling.getConfig(); // only overridden knobs, nested, plain JSON
styling.applyConfig(settings);                                     // replace all knobs with these — NOT checked at run time
styling.updateConfig(settings);                                    // replace the top-level groups given (`colors`, `view`, …), keep the others
styling.events.on('config-change', (settings) => save(settings));  // fires after every setKnob/setKnobs/resetKnob/applyConfig/updateConfig

setKnobs(styling, stylingFoundationsKnobCatalogue, JSON.parse(fromUrl)); // settings from outside your code: { 'labels.sizeFactor': 1.2 }, checked, all or none
```

## Build a UI from the catalogue

```ts
// A drag fires `input` far faster than a restyle runs: coalesce to one set per frame, last value wins.
let pending: number | string | undefined;
let frame = 0;
const queue = (id: StylingFoundationsKnobId, value: number | string) => {
    pending = value;
    if (!frame) {
        frame = requestAnimationFrame(() => {
            frame = 0;
            setKnob(styling, stylingFoundationsKnobCatalogue, id, pending);
        });
    }
};

for (const knob of stylingFoundationsKnobCatalogue) {
    if (knob.kind === 'toggle') {
        checkbox.checked = getKnob(styling, stylingFoundationsKnobCatalogue, knob.id) === true;
        checkbox.onchange = () => setKnob(styling, stylingFoundationsKnobCatalogue, knob.id, checkbox.checked);
    } else if (knob.kind === 'color') {
        picker.oninput = () => queue(knob.id, picker.value); // same story: the picker fires continuously
    } else if (knob.kind === 'enum') {
        for (const option of knob.options ?? []) select.add(new Option(option));
        select.onchange = () => setKnob(styling, stylingFoundationsKnobCatalogue, knob.id, select.value);
    } else { // factor or number
        slider.min = String(knob.range!.min); slider.max = String(knob.range!.max); slider.step = String(knob.range!.step);
        slider.oninput = () => queue(knob.id, Number(slider.value));
        slider.onchange = () => setKnob(styling, stylingFoundationsKnobCatalogue, knob.id, Number(slider.value)); // the released value always lands
    }
}
```

**Do not rebuild the panel from `config-change` when the change came from the panel.** `setKnob` emits
the event, so rebuilding replaces the input the pointer is dragging and the control fights the drag.
Rebuild only on external changes (a reset, a `setStyle`, an agent) — keep a flag around your own
`setKnob` calls and skip the rebuild while it is up. `examples/map-styling-playground` does both.

## Hillshade

The shading's look is `TerrainModule`'s `hillshade.*` knobs — method, light, strength, max zoom, colours — in `map-setup.md` § TerrainModule. Their map-wide colour ids carry `terrain.`: `getStyleColor(map, 'terrain.hillshade.colors.shaded')`.

## Advanced tier — `styling.layers.query(...)` (version-coupled)

```ts
import type { ExpressionFilterSpecification, ExpressionSpecification } from 'maplibre-gl';

styling.layers.query({ group: 'roadLabels' }).setPaint({ 'text-color': '#93c5fd' });        // by base-map group
styling.layers.query({ metadataGroups: ['water'], layerTypes: ['fill'] }).setPaint({ 'fill-opacity': 0.6 });
styling.layers.query({ idIncludes: ['railway'] }).setVisible(false).setLayout({ 'line-cap': 'round' });
styling.layers.query({ sourceLayers: ['poi'] }).setFilter(['==', ['get', 'group'], 'transport']);
styling.layers.query({ group: 'trafficFlow', layerTypes: ['line'] }).setPaint({ 'line-blur': 2 }); // another style-owned module's layers
styling.layers.query({ ids: ['Water - Fill'] }).setPaint({ 'fill-color': '#1e3a5f' });       // exact layer ids
styling.layers.query({ group: 'roadLabels' }).reset();                                       // undo those edits
styling.layers.query({ group: 'railways' }).layerIds;                                        // what matched, in draw order

// A derivation (LayerPropertyDerivation): built per layer from the value beneath — the style's, or a knob's
const motorway: ExpressionSpecification = ['==', ['get', 'category'], 'motorway'];
const isRamp = (value: unknown[]) => ['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step'].includes(String(value[0]));
styling.layers.query({ group: 'roadLabels' }).setPaint({
  'text-color': (color, layerId) => // `TransitLabels - Path` draws a zoom ramp, which no `case` may wrap
    typeof color === 'string' || (Array.isArray(color) && !isRamp(color)) ? ['case', motorway, '#c026d3', color] : color,
});

// A filter clause, and-ed with the style's own filter instead of replacing it
const majorRoads: ExpressionFilterSpecification = ['in', ['get', 'category'], ['literal', ['motorway', 'trunk', 'primary']]];
styling.layers.query({ group: 'roadLabels' }).addFilterClause(majorRoads);
styling.layers.query({ group: 'roadLabels' }).removeFilterClause(majorRoads);
```

`group` (`StyleLayerGroupName`) is a base-map group (`BaseMapModule`'s names) or another style-owned module's layers: `pois`, `trafficFlow`, `trafficIncidents`, `hillshade` (`styleModuleLayerGroupNames`). **Only the style's own layers**: queries and knobs never reach what a data-owned module adds — restyle those through that module's `layers` config (Places, Routing, Geometries / Reachable ranges, Traffic incident details, Traffic area analytics), merged over its defaults and kept across `setStyle` — nor the layers you add through `map.mapLibreMap`. The other `LayerQuery` fields — `metadataGroups`, `layerTypes`, `sourceLayers`, `ids` (exact), `idIncludes`, `idExcludes` (case-insensitive) — must all hold too, so they narrow `group`. `setPaint`/`setLayout` take MapLibre's typed paint/layout properties (`LayerPropertyValues`), each a value or a derivation `(valueUnder, layerId) => value`:

- `valueUnder` is the style's own value, or the knob's when a knob set that property (`setMapColors`' `colors.label` reaches road labels), and the derivation re-runs after every `setStyle` and knob change — so the app's expression and the knob compose. `reset()` writes `valueUnder` back.
- `valueUnder` is `undefined` where the style leaves the property unset, and can be a legacy `{ stops }` function: narrow it (`typeof === 'string' || Array.isArray`) before embedding it in an expression.
- `["zoom"]` is only legal as the input of a top-level `interpolate`/`step`: wrapping a zoom ramp (`['case', …, ramp]`, `['*', 2, ramp]`) is rejected — rewrite each stop's output instead. A rejected value throws from `setPaint`/`setLayout`; rejected only on a later re-run (after `setStyle` or a knob change), it warns once and that layer keeps `valueUnder`.

`setFilter` replaces the style's own filter; `addFilterClause(clause)` narrows it instead (`all` with the style's filter, or `setFilter`'s, and with module filters such as POI categories), once per equal clause, and `removeFilterClause(clause)` withdraws it by value. **Confining the map to an area**: `addFilterClause(['within', polygon])` keeps the labels (points, lines) inside it, but MapLibre's `within` evaluates points and lines only, so on polygon layers (`buildings3D`, land use, water) it hides every feature. No filter cuts a polygon at an edge, and the SDK has no area option for the base map; hide polygon groups through `BaseMapModule` or draw your own clipped copy. `setVisible` (or a `visibility` of `'visible'` / `'none'` in `setLayout`, which takes no expression) never shows a layer its module hides. Re-applied after `setStyle` while the layers exist; dropped on `resetState: true`; **not** in `getConfig()`. Layer ids/expressions belong to the loaded style, which an SDK minor can change, and aren't public API — prefer knobs/`setMapColors` where they cover the intent. An empty match warns once.

## Gotchas

- Settings survive `map.setStyle(style)` (re-applied last, after the other modules restore) and are dropped by `setStyle(style, { resetState: true })`.
- Module boundaries: this module holds the foundations across every part; the look of one part is its own module's knobs (§ Knob ids), and which module owns visibility, filters and data-owned layers is the *Who owns what* table in `map-setup.md`.
- Knobs never write the SDK's own overlays (PlacesModule pins, routes, geometries, BYOD) — those have their own display config. The few parts that borrow a look from the style read it back and follow its knobs (§ Borrowed looks).
- `symbols.sizeFactor` and `labels.sizeFactor` both reach POI layers, as does `POIsModule`'s `sizeFactor`; factors on the same property multiply.
- A knob writes the **whole** value of each property it reaches, computed from the style's own value. A `setPaintProperty` on one of those properties — a `['coalesce', ['feature-state', …], …]` wrapper included — is replaced whenever the knob applies (set, reset, `setStyle`). To compose an app's expression with a knob on one property, pass `styling.layers.query(…).setPaint` a derivation (§ Advanced tier): it is handed the knob's value and runs again whenever the knob moves.
- Agent toolkit: the look knobs of every module are the `setMapStyling` tool, by their map-wide ids, whose schema names every id and range (see `agent-toolkit/tools.md`).
