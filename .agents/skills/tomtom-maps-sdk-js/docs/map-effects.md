# Map Effects Plugin Reference

Practical post-processing over a `TomTomMap`, computed from the rendered pixels — style-independent, survives style releases. Use it for **muting the base map under data**, **emphasis on dark/driving styles (bloom)**, **focus (fog, edge blur, vignette)** and **depth on a tilted 3D map (depth of field)** — no knob is an "artistic" look; an app's own stylisation (watercolour, posterise) runs inside the chain through `addPass`.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-map-effects`.

## Imports

```ts
import {
    MapEffects,
    effectKnobCatalogue,
    effectKnobIds,
    type BloomScope,             // readonly BloomScopeEntry[] — the value of `bloom.only`
    type CaptureOptions,         // { pixelRatio? }
    type EffectKnob,             // one catalogue entry
    type EffectKnobId,
    type EffectKnobValueOf,
    type MapEffectsPass,         // { id, fragment, uniforms?, placement? }
    type MapEffectsPassPlacement,
    type MapEffectsConfig,       // the knobs set, nested along their ids ({ bloom: { intensity } }), as getConfig() returns them
    type StyleColorKnobGroup,    // `traffic`, `traffic.incidents`, `colors`, …
} from '@tomtom-org/maps-sdk-plugin-map-effects';
```

## Setup

```ts
const map = new TomTomMap({
    style: 'streetDark',
    mapLibre: {
        container: 'map',
        // REQUIRED for bloom, the depth of field, app passes and capture (they read the canvas back). The plugin warns once if missing.
        canvasContextAttributes: { preserveDrawingBuffer: true },
    },
});
const effects = new MapEffects(map);                      // everything off
const effects = new MapEffects(map, { tint: { opacity: 0.2 } }); // with an initial config, nested along the knob ids
```

## Set / get / reset

Same rules as a map module. Values held as data (a panel, storage, an LLM) go through the SDK's knob functions by id: each knob lands at its path, every other knob kept, including the rest of its effect. Typed values your code writes go through the config methods; `updateConfig` **replaces each effect it names** (`updateConfig({ bloom: { threshold } })` drops the bloom's other knobs).

```ts
import { getKnob, resetKnob, setKnob, setKnobs } from '@tomtom-org/maps-sdk/map';
import { effectKnobCatalogue } from '@tomtom-org/maps-sdk-plugin-map-effects';

setKnob(effects, effectKnobCatalogue, 'vignette.intensity', -0.4);                     // one knob: focus the centre
setKnobs(effects, effectKnobCatalogue, { 'bloom.intensity': 0.5, 'bloom.threshold': 0.6 }); // several, one change, all or none
// Code: whole effects, the effects not named kept
effects.updateConfig({ grade: { saturation: 0.4, brightness: 0.85 }, tint: { opacity: 0.15 } }); // mute under data

getKnob(effects, effectKnobCatalogue, 'bloom.intensity');   // current value or default
resetKnob(effects, effectKnobCatalogue, 'bloom.intensity'); // one knob to default (off)
effects.resetConfig();                                      // all off
effects.getConfig();                                        // overridden knobs only — plain JSON
effects.applyConfig(config);                                // replace all
effects.remove();                                           // detach, remove the layers, release the chain's WebGL context
```

`setKnob` and `setKnobs` check every value with the SDK's `validateKnobValue` first: a refused value throws `RangeError`, an unknown id `Error`, and nothing is touched on a failed call. The constructor, `applyConfig` and `updateConfig` check nothing at run time (TypeScript only), as on a map module. There is no `set`, `get` or `reset` method. Call `remove()` when a page drops a map: a browser caps the WebGL contexts a page may hold, and the map already holds one.

## Knob ids

| Group | Ids | Range | Default |
| --- | --- | --- | --- |
| bloom | `bloom.intensity`, `bloom.threshold` / `bloom.radius` | 0–1 / 2–40 px | 0 (off), 0.55 / 12 |
| bloom scope | `bloom.only` / `bloom.onlyTolerance` | list of style colour knobs, groups, CSS colours / 0–1 | `[]` (whole frame) / 0.15 |
| grade | `grade.brightness`, `grade.contrast` / `grade.saturation` | 0.5–1.5 / 0–1.5 | 1 |
| tint | `tint.color` / `tint.opacity` | colour / 0–1 | `#1f2937` / 0 (off) |
| fog | `fog.intensity`, `fog.reach` | 0–1 | 0 (off), 0.4 |
| edgeBlur | `edgeBlur.intensity` / `edgeBlur.reach` | 0–30 px / 0–1 | 0 (off) / 0.5 |
| depthOfField | `depthOfField.intensity` / `depthOfField.focus`, `depthOfField.band`, `depthOfField.bokeh` | 0–30 px / 0–1 | 0 (off) / 0, 0.3, 0.5 |
| vignette | `vignette.intensity` (− darkens, + lightens) / `vignette.reach` | −1–1 / 0–1 | 0 (off) / 0.45 |

**fog vs edgeBlur** — both blur the rim and take a `reach`; the difference is the rim's colour. `fog` also washes it out towards the colour of the air (pale on a light style, dark on a dark one, following `map.styleLightDarkTheme`), so it reads as distance. `edgeBlur` leaves colour alone, so it reads as a lens — use it when the rim's colour still carries data. They compound if both are on.

**depthOfField** — the only **GPU** effect (a WebGL2 full-screen pass) and the only one that reads the map's **camera**. For a plane, `1/z` is affine in the screen row, so pitch + vertical FOV give the whole depth of the frame as one ramp (`2·tan(fov/2)·tan(pitch)`, normalised); the circle of confusion then grows with distance from the plane of focus, per pixel. `focus` runs 0 = nearest ground (bottom) → 1 = farthest the frame shows (top); `band` is the amount of depth held sharp, on that ramp's fixed scale (not a share of the frame's depth); `intensity` is the widest circle of confusion in CSS px; `bokeh` decides whether a defocused highlight fades or returns as a disc.

```ts
await TerrainModule.get(map, { elevation: { visible: true } }); // the relief to defocus
effects.updateConfig({ depthOfField: { intensity: 18, focus: 0, band: 0.3, bokeh: 0.5 } });
```

- **Needs `preserveDrawingBuffer: true`** on the map, like bloom and `capture()`: the pass reads the rendered map back as a texture.
- **A flat map switches it off by geometry** — ramp 0, no pass run, no pitch check anywhere. Tilt the map and it returns; the pass redraws on the map's `render`, coalesced to one draw per animation frame.
- `focus: 0` needs nothing detected: the nearest thing in a tilted frame is the bottom edge. Mid `focus` with a small `band` is the tilt-shift look.
- The same `band` holds more of the view at a gentle tilt, because it is an amount of depth rather than a share of the frame, and a gentle tilt puts little depth in the frame.
- **Bloom reads the defocused picture** when this is on, so a blurred highlight glows as a disc rather than a pinpoint.

## Scoping bloom — `bloom.only`

A list of the colours bloom may light; entries mix freely, and `[]` (the default) lights the whole frame:

```ts
effects.updateConfig({ bloom: { intensity: 0.9, only: ['traffic'] } }); // a group: every traffic colour knob
setKnob(effects, effectKnobCatalogue, 'bloom.only', ['traffic.incidents.colors.major', 'traffic.incidents.colors.closed']); // single knobs
setKnob(effects, effectKnobCatalogue, 'bloom.only', ['traffic', '#1a73e8']); // + a CSS colour, e.g. a route's color
```

- **Named entries**: a style colour knob by its map-wide id (`StyleColorKnobId`, `styleColorKnobIds` from `@tomtom-org/maps-sdk/map`), whichever module owns it, or a dotted group of them (`StyleColorKnobGroup`, from the plugin: `traffic`, `traffic.incidents`, `colors`, `pois`, `terrain`…).
  - Read with the SDK's `getStyleColor`, so a recolour or style switch moves the scope on its own, and no module needs to exist.
  - `effectKnobCatalogue` lists every name in the knob's `options`; any other entry must parse as a CSS colour, or setting it throws `RangeError`.
- **CSS colours** cover what no style colour knob paints: routes (`RoutingModule`'s `color`), places, your own layers.
- **Colour, not layers**: anything else wearing those colours glows too.
  - A knob the style paints with an expression scopes to nothing: bloom lights everything, with one console warning.
  - The TomTom styles give flow and incidents one palette (`traffic.flow.colors.stationary` *is* `traffic.incidents.colors.major`), so `traffic.flow` also keys those incidents.
- **Brightness is not compared** (`bloom.threshold` owns level); `bloom.onlyTolerance` covers antialiased edges.
  - A scope usually wants a **lower `bloom.threshold`**: `monoDark`'s major jam `hsl(0, 100%, 28%)` keeps 64/255 above a `0.45` cut, 110/255 above `0.25`.

## Your own GPU passes — `addPass` / `removePass`

A full-screen fragment shader of yours, run **inside the plugin's WebGL chain** — so bloom, grade, fog, edge blur, tint and vignette all read what it drew. The slot for a stylisation (watercolour, posterise, colour LUT):

```ts
effects.addPass({
    id: 'posterise',                               // replace-in-place key, and what removePass takes
    fragment: `uniform float uLevels;
        void main() { vec4 colour = texture(uSource, vUv); fragColor = vec4(floor(colour.rgb * uLevels) / uLevels, colour.a); }`,
    uniforms: { uLevels: 5 },                      // float or vec2 by name, or () => ({ … }) read every draw
    placement: 'before-depth-of-field',            // default; 'after-depth-of-field' keeps it crisp
});
effects.removePass('posterise');
```

- **Don't redeclare the preamble**: `#version 300 es`, precisions, `uSource`, `vUv`, `fragColor` are provided. `addPass` throws on a missing `id`, on a shader that doesn't compile (with the compiler log), and with `RangeError` on an unknown `placement`. Without WebGL2 no pass runs, and the plugin warns once.
- **Order**: passes run in the order added, within their placement; re-adding an `id` replaces that pass in place. `removePass` ignores an unknown id.
- **Uniforms are `float` or `vec2` only**: an `int` / `bool` uniform can't be set and stays 0. A `uniforms()` that throws skips its pass for that draw, with one warning.
- **Redraws with the map**: a self-animating pass calls `map.mapLibreMap.triggerRepaint()`.
- **`capture()` includes passes; `getConfig()` doesn't** (passes are code).
- **A hue-shifting pass runs before bloom's colour key**: widen `bloom.onlyTolerance` if a `bloom.only` scope stops finding its colours.
- **An effect on top of everything** (grain, scanlines) needs no pass: put your own element above the map.

## Catalogue — `effectKnobCatalogue`

Static data, no map needed, in compositing order: `{ id, kind, description, default, useCase }` plus `range` (`min`, `max`, `step`, `bounds` always `hard`) on a `number` knob, and `options` (every style colour knob id and group) on `bloom.only`. `getKnob(effects, effectKnobCatalogue, id)` reads the value set, else the default.

```ts
for (const knob of effectKnobCatalogue) { /* knob.kind is 'number', 'color' or 'colors' */ }
```

## Capture (high-DPI)

```ts
const canvas = await effects.capture({ pixelRatio: 3 }); // map + effects, re-rendered at 3×
canvas.toBlob((blob) => upload(blob), 'image/png');
```

Re-renders at the new ratio (never resamples), waits for `idle` (15 s at most), reads back, then sets the map back to the ratio it had; without `pixelRatio` it reads the current frame. Passes and bloom scope included. MapLibre clamps to `maxCanvasSize` — measure `canvas.width / map.mapLibreMap.getCanvas().clientWidth` for the ratio you actually got.

## Gotchas

- Without `preserveDrawingBuffer: true`, bloom is blank, the depth of field and app passes do nothing, and capture returns an empty map.
- Effects are DOM overlays under the map controls with `pointer-events: none`; they do not affect hit-testing or SDK events.
- Compositing order: the GPU chain (your passes, the depth of field), then bloom blended in `screen` mode over it, then the CSS overlays (grade, fog, edge blur, tint, vignette) over both — so a grade, tint or vignette changes the glow too.
- Effects change the *frame*, the modules' knobs change the *style*; compose them (e.g. `await applyMapPreset(map, 'data-viz')` + `setKnob(effects, effectKnobCatalogue, 'grade.saturation', 0.4)`).
- Bloom redraws on every map `render` (coalesced per animation frame) at a quarter of the pixels; keep `bloom.radius` moderate on large canvases.
