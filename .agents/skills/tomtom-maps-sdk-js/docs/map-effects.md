# Map Effects Plugin Reference

Practical post-processing over a `TomTomMap`, computed from the rendered pixels — style-independent, survives style releases. Use it for **muting the base map under data**, **emphasis on dark/driving styles (bloom)**, **lights that shine like lamps through a lens (glare)**, **focus (fog, edge blur, vignette)** and **depth on a tilted 3D map (depth of field)** — no knob is an "artistic" look; an app's own stylisation (watercolour, posterise, split tone) runs inside the chain through `addPass`, and its own 2D layer (paper, film grain, a watermark) between the overlays through `addLayer`.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-map-effects`.

## Imports

```ts
import {
    MapEffects,
    effectKnobCatalogue,
    effectKnobIds,
    type BloomScope,             // readonly BloomScopeEntry[] — the value of `bloom.only` and `glare.only`
    type CaptureOptions,         // { pixelRatio? }
    type EffectKnob,             // one catalogue entry
    type EffectKnobId,
    type EffectKnobValueOf,
    type MapEffectsLayer,        // { id, placement, draw(context, { width, height, pixelRatio }) }
    type MapEffectsLayerPlacement, // `after-bloom` … `after-vignette`
    type MapEffectsPass,         // { id, fragment, uniforms?, textures?, mipmapped?, placement? }
    type MapEffectsPassPlacement,
    type MapEffectsPassUniforms, // number | [x, y] | [x, y, z] | [x, y, z, w] by name
    type MapEffectsConfig,       // the knobs set, nested along their ids ({ bloom: { intensity } }), as getConfig() returns them
    type StyleColorKnobGroup,    // `traffic`, `traffic.incidents`, `colors`, …
} from '@tomtom-org/maps-sdk-plugin-map-effects';
```

## Setup

```ts
const map = new TomTomMap({
    style: 'streetDark',
    // No `preserveDrawingBuffer`: the effects read the map's frame in its own `render` event.
    mapLibre: { container: 'map' },
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
| bloom | `bloom.intensity`, `bloom.threshold` / `bloom.radius` | 0–1 / ≥ 2 px, slider to 40 | 0 (off), 0.55 / 12 |
| bloom scope | `bloom.only` / `bloom.onlyTolerance` | list of style colour knobs, groups, CSS colours / ≥ 0, slider to 1 | `[]` (whole frame) / 0.15 |
| glare | `glare.intensity`, `glare.threshold` / `glare.length` / `glare.rays` / `glare.angle` | 0–1 / ≥ 4 px, slider to 120 / 2–8, step 2 / 0–180° | 0 (off), 0.3 / 32 / 4 / 45 |
| glare scope | `glare.only` / `glare.onlyTolerance` | as `bloom.only` / ≥ 0, slider to 1 | `['colors.roadMajor']` / 0.15 |
| grade | `grade.brightness`, `grade.contrast` / `grade.saturation` | ≥ 0.5, slider to 1.5 / ≥ 0, slider to 1.5 | 1 |
| tint | `tint.color` / `tint.opacity` | colour / 0–1 | `#1f2937` / 0 (off) |
| fog | `fog.intensity`, `fog.reach` / `fog.color` | 0–1 / colour | 0 (off), 0.4 / none: the theme's air |
| edgeBlur | `edgeBlur.intensity` / `edgeBlur.reach` | ≥ 0 px, slider to 30 / 0–1 | 0 (off) / 0.5 |
| depthOfField | `depthOfField.intensity` / `depthOfField.focus`, `depthOfField.band`, `depthOfField.bokeh` | ≥ 0 px, slider to 30 / 0–1 | 0 (off) / 0, 0.3, 0.5 |
| vignette | `vignette.intensity` (− darkens, + lightens) / `vignette.reach` | −1–1 / 0–1 | 0 (off) / 0.45 |

**fog vs edgeBlur** — both blur the rim and take a `reach`; the difference is the rim's colour. `fog` also washes it out towards the colour of the air, so it reads as distance. The air is `fog.color` when set (its lightness brightens or darkens the rim's grade, and its alpha thins both the veil and that change), otherwise the theme's: pale on a light style, dark on a dark one, following `map.styleLightDarkTheme` through every switch. Reset `fog.color` to hand the air back to the theme. `edgeBlur` leaves colour alone, so it reads as a lens — use it when the rim's colour still carries data. They compound if both are on.

**depthOfField** — a **GPU** effect (a WebGL2 full-screen pass), as the glare is, and the only one that reads the map's **camera**. Without WebGL2 the map stays sharp, with one warning. For a plane, `1/z` is affine in the screen row, so pitch + vertical FOV give the whole depth of the frame as one ramp (`2·tan(fov/2)·tan(pitch)`, normalised); the circle of confusion then grows with distance from the plane of focus, per pixel. `focus` runs 0 = nearest ground (bottom) → 1 = farthest the frame shows (top); `band` is the amount of depth held sharp, on that ramp's fixed scale (not a share of the frame's depth); `intensity` is the widest circle of confusion in CSS px; `bokeh` decides whether a defocused highlight fades or returns as a disc.

```ts
await TerrainModule.get(map, { elevation: { visible: true } }); // the relief to defocus
effects.updateConfig({ depthOfField: { intensity: 18, focus: 0, band: 0.3, bokeh: 0.5 } });
```

- **A flat map switches it off by geometry** — ramp 0, no pass run, no pitch check anywhere. Tilt the map and it returns; the pass redraws in the map's `render` event, in the same frame as the map.
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
- **Runs in the GPU chain**, as its last stages: the colours are keyed on the GPU, so a scope costs three full-size passes plus the chain. It needs WebGL2.
- **Brightness is not compared** (`bloom.threshold` owns level); `bloom.onlyTolerance` covers antialiased edges.
  - A scope usually wants a **lower `bloom.threshold`**: `monoDark`'s major jam `hsl(0, 100%, 28%)` keeps 64/255 above a `0.45` cut, 110/255 above `0.25`.

## Glare — `glare.*`

Streaks out of the lights, as a star filter or an anamorphic lens draws them from a street lamp. The lights are the colours `glare.only` names, scoped exactly as `bloom.only` is (same entries, same `getStyleColor` resolution, same `options`), but **by default `['colors.roadMajor']`**: the loaded style's major roads.

```ts
effects.updateConfig({ glare: { intensity: 0.8, length: 48 } }); // the major roads, a 4-ray cross at 45°
setKnob(effects, effectKnobCatalogue, 'glare.only', ['#1a73e8']); // a route's colour instead
// Street lights: glare and a bloom on the same colour; the bloom glows along the streaks
effects.updateConfig({
    glare: { intensity: 0.8, length: 48 },
    bloom: { intensity: 0.5, radius: 10, threshold: 0.3, only: ['colors.roadMajor'] },
});
```

- **`rays`**: 2 = one line per light (anamorphic; horizontal at `angle: 0`), 4 = a cross, 6 / 8 = a star; an odd count rounds up. `angle` is the first ray's direction in degrees anticlockwise from horizontal; the rest share the turn evenly. `length` is in CSS px, and a streak fades over it.
- **A light's shape decides the look**: a small light (icon, dot) becomes a star; a lit line (a road) gets a soft sheen along its length, since every point on it streaks.
- **`[]` streaks every pixel above `threshold`, labels included**; a name that resolves to no colour does the same, with one console warning.
- On `monoDark` / `monoLight` the major roads are grey, and a grey key matches every grey: name a colour there.
- **GPU only**: two stages of the chain, after the depth of field and before a scoped bloom. Without WebGL2 it draws nothing (one warning). Each pair of opposite rays reads 32 samples per pixel, so `rays: 8` reads 128.

## Your own GPU passes — `addPass` / `removePass`

A full-screen fragment shader of yours, run **inside the plugin's WebGL chain** — so bloom, grade, fog, edge blur, tint and vignette all read what it drew. The slot for a stylisation (watercolour, posterise, split tone, colour LUT):

```ts
effects.addPass({
    id: 'posterise',                               // replace-in-place key, and what removePass takes
    fragment: `uniform float uLevels;
        void main() { vec4 colour = texture(uSource, vUv); fragColor = vec4(floor(colour.rgb * uLevels) / uLevels, colour.a); }`,
    uniforms: { uLevels: 5 },                      // a number, or 2–4 numbers as vec2–vec4, by name, or () => ({ … }) read every draw
    placement: 'before-depth-of-field',            // default; 'after-depth-of-field' keeps it crisp
});
effects.removePass('posterise');

effects.addPass({
    id: 'paper-tone',
    fragment: `uniform sampler2D uPaper; uniform vec3 uTone;
        void main() { vec4 colour = texture(uSource, vUv); float grain = texture(uPaper, vUv * 4.0).r;
            fragColor = vec4(colour.rgb * mix(uTone, vec3(1.0), grain), colour.a); }`,
    uniforms: { uTone: [0.95, 0.9, 0.8] },         // a vec3: a colour
    textures: { uPaper: paperImage },              // a sampler2D by name: any TexImageSource, or () => source | undefined
});
```

- **Don't redeclare the preamble**: `#version 300 es`, precisions, `uSource`, `vUv`, `fragColor` are provided. `addPass` throws on a missing `id`, on a shader that doesn't compile (with the compiler log), and with `RangeError` on an unknown `placement`. Without WebGL2 no pass runs, and the plugin warns once.
- **Order**: passes run in the order added, within their placement; re-adding an `id` replaces that pass in place. `removePass` ignores an unknown id.
- **Uniforms are `float` to `vec4`**: a number, or an array of 2–4 numbers (a colour is a `vec3`). An `int` uniform can't be set and stays 0; a `bool` takes a number, 0 as false. A `uniforms()` or `textures()` that throws skips its pass for that draw, with one warning.
- **`textures`**: up to 15 by name, on texture units 1–15 in the order listed (`uSource` keeps 0; a texture named `uSource`, or a 16th, throws `RangeError`).
  - A **video or canvas** re-uploads on every draw (live pixels, same object); an **image, `ImageBitmap`, `VideoFrame` or `ImageData` once per object**: to change it, hand a new object (from a `textures()` function).
  - A playing video still redraws only with the map: call `triggerRepaint()` per frame (`requestVideoFrameCallback`).
  - Upright like `uSource`, linear, repeating past its edges, no mips. Freed on `removePass`, or when a function swaps the object.
  - An image not `complete`, a video without a frame (`readyState` < `HAVE_CURRENT_DATA`), or `undefined` from the function skips the pass for that draw — call `triggerRepaint()` on load.
- **`mipmapped: true`** builds `uSource`'s mip levels before the pass, for a pass that gathers with `textureLod`; without it every level reads level 0.
- **Redraws with the map**: a self-animating pass calls `map.mapLibreMap.triggerRepaint()`.
- **`capture()` includes passes; `getConfig()` doesn't** (passes are code).
- **A hue-shifting pass runs before bloom's and glare's colour keys**: widen `bloom.onlyTolerance` / `glare.onlyTolerance` if a `bloom.only` / `glare.only` scope stops finding its colours.
- **Film grain, split tone, a lens look** are not knobs: write them as a pass or a layer.

## Your own 2D layers — `addLayer` / `removeLayer`

A 2D canvas of yours at a place in the **overlay stack**, drawn live and, in the same place, by `capture()`. The slot for paper, film grain, scanlines, a frame or a watermark — anything only some effects should work on:

```ts
effects.addLayer({
    id: 'paper',                                   // replace-in-place key, and what removeLayer takes
    placement: 'after-edgeBlur',                   // right above that overlay: tint and vignette work on it
    draw: (context, { width, height, pixelRatio }) => { // device pixels; pixelRatio = device px per CSS px
        context.globalAlpha = 0.25;
        context.fillStyle = context.createPattern(paperImage, 'repeat') ?? 'transparent';
        context.fillRect(0, 0, width, height);
    },
});
effects.removeLayer('paper');
```

- **Placements**, bottom to top: `after-bloom`, `after-grade`, `after-fog`, `after-edgeBlur`, `after-tint`, `after-vignette` (over every effect). Every overlay above the layer works on it. Not MapLibre's `map.addLayer`: this is a canvas, not a style layer, and it never touches hit-testing.
- `draw` gets a **cleared** context the size of the map canvas, its state saved and restored around the call. It runs in every map `render` event, and once more at the capture's size in `capture()`; an animated layer calls `triggerRepaint()`.
- `addLayer` throws on a missing `id`, `RangeError` on an unknown `placement`. Layers in one placement stack in the order added. A `draw` that throws leaves its layer empty for that draw, with one warning. `getConfig()` doesn't list layers. No WebGL2 needed.

## Catalogue — `effectKnobCatalogue`

Static data, no map needed, grouped by effect in the order the overlays stack (the glare and the depth of field, GPU passes under every overlay, sit beside the bloom and the edge blur): `{ id, kind, description, default, useCase }` plus `range` (`min`, `max`, `step`, `bounds`) on a `number` knob, and `options` (every style colour knob id and group) on `bloom.only` and `glare.only`. `fog.color` has no `default` (the theme decides). `bounds` is `hard` only where the maths breaks past it (a 0–1 strength, cut or share, `glare.rays`, `glare.angle`, `vignette.intensity`); the rest are `hard-min` (`bloom.radius`, both `onlyTolerance`s, `glare.length`, every `grade.*`, `edgeBlur.intensity`, `depthOfField.intensity`): `setKnob` refuses a value under `min`, and `max` is only a slider's end. `getKnob(effects, effectKnobCatalogue, id)` reads the value set, else the default (`undefined` for an unset `fog.color`).

```ts
for (const knob of effectKnobCatalogue) { /* knob.kind is 'number', 'color' or 'colors' */ }
```

## Capture (high-DPI)

```ts
const canvas = await effects.capture({ pixelRatio: 3 }); // map + effects, re-rendered at 3×
canvas.toBlob((blob) => upload(blob), 'image/png');
```

Re-renders at the new ratio (never resamples), waits for `idle` (15 s at most), reads back, then sets the map back to the ratio it had; without `pixelRatio` it reads at the live ratio, first waiting for `idle` (the same 15 s at most) while tiles are still loading. Passes, layers and bloom scope included. MapLibre clamps to `maxCanvasSize` — measure `canvas.width / map.mapLibreMap.getCanvas().clientWidth` for the ratio you actually got. A capture asked for during another waits for it; a `pixelRatio` that isn't a positive number rejects with a `RangeError`.

## Gotchas

- **No `preserveDrawingBuffer`**: the effects draw in the same frame as the map, reading its canvas inside its `render` event, and `capture()` reads it there too. Setting the flag costs a copy of the map's frame every frame, and the effects don't need it.
- A bloom, glare or depth-of-field knob change, or `addPass` / `removePass`, asks the map for one frame (`triggerRepaint`), so an idle map redraws once; a grade, tint, fog, edge blur or vignette change asks for none. A pass or layer that changes on its own still calls `map.mapLibreMap.triggerRepaint()` for every frame it needs.
- A frame the effects fail to draw (e.g. a pass texture from another origin loaded without CORS) shows the map without the chain and the bloom and warns once; `capture()` rejects with the error.
- Effects are DOM overlays under the map controls with `pointer-events: none`; they do not affect hit-testing or SDK events.
- HTML markers (`maplibregl.Marker`), popups and controls sit **above** every effect, the depth of field's opaque canvas included, whenever the marker was added. To have a pin take the effects, draw it as a symbol layer instead.
- The chain takes its WebGL2 context on the first stage it runs (a pass, the depth of field, the glare or a `bloom.only` scope), not in the constructor; unscoped bloom and the CSS overlays need none. Once taken it is held until `remove()`. Without WebGL2 a scoped bloom draws no glow (one warning) rather than lighting the whole frame.
- The depth of field reads depth from the ground plane, so a tower takes the depth of the ground behind it at the same screen row: its top blurs with the far city. Raise `focus` to keep a tall subject sharp, or keep it low to soften the distance and the tower's top with it.
- Compositing order: the GPU chain (your passes, the depth of field, the glare, then a scoped bloom), then an unscoped bloom blended in `screen` mode over it, then the CSS overlays (grade, fog, edge blur, tint, vignette) over both, with your `addLayer` layers between them — so a grade, tint or vignette changes the glow too, and an `after-bloom` layer sits above either bloom.
- Effects change the *frame*, the modules' knobs change the *style*; compose them (e.g. `await applyMapPreset(map, 'data-viz')` + `setKnob(effects, effectKnobCatalogue, 'grade.saturation', 0.4)`).
- **Per-frame cost** (the guide's *How it renders → What each effect costs* has the table), for a map that redraws every frame, e.g. under an animated three.js layer:
  - grade, tint, vignette: one CSS layer each, nothing drawn by the plugin; fog and edge blur add a `backdrop-filter` blur;
  - unscoped bloom: a quarter-pixel 2D canvas drawn through a CSS filter, in every `render` event; keep `bloom.radius` moderate on large canvases;
  - the depth of field, each app pass: one full-size GPU pass; the glare: two, the second 32 samples per pixel per pair of rays; a `bloom.only` scope: three. The scope cube is uploaded once per scope or style change, and nothing is read back to the CPU;
  - the chain itself, once any stage runs: a copy of the whole map canvas into its WebGL context per frame, plus its canvas layer. Turning on `bloom.only` therefore takes the chain on, if nothing else had;
  - the map's own buffer: swapped every frame, not copied, since no effect needs `preserveDrawingBuffer`;
  - every cost scales with device pixels: `map.mapLibreMap.setPixelRatio(…)` is the one lever that trades sharpness for all of them.
