# Map Theming Reference — a look from a website, a stylesheet, an image, a palette or an artist

Turn *where a look comes from* into the ten semantic map colours (`land`, `water`, `vegetation`, `park`, `artificial`, `roadMajor`, `road`, `roadOutline`, `label`, `labelHalo`) plus `accent`, the colour for what is drawn **on top** of the map, then apply them with `StylingFoundationsModule.setMapColors` (`map-styling.md`). The `@tomtom-org/maps-sdk-plugin-map-theme` plugin: pure functions, no backend, no map needed to derive.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — the map-theme plugin. `setMapColors` and `map.mapColors` are SDK features, not part of it.

```bash
npm install @tomtom-org/maps-sdk-plugin-map-theme   # peers: @tomtom-org/maps-sdk, culori
```

## Imports

```ts
import { GeometriesModule, RoutingModule, StylingFoundationsModule } from '@tomtom-org/maps-sdk/map';
import {
    deriveMapColors,           // colours[] -> ten base-map roles + accent
    mapColorsLightDark,        // those roles -> 'light' | 'dark', to pick the style they recolour
    deriveMapColorsFromCss,    // stylesheet text -> the colours it paints with most -> the same roles
    cssColors,                 // stylesheet text -> hex colours, most used first
    deriveMapColorsFromImage,  // image -> dominant colours -> the same roles
    dominantColors,            // ImageData-like pixels -> hex colours, largest area first
    type MapThemeMode,         // 'light' | 'dark' | 'auto'
    mapThemeModes,             // every MapThemeMode, to validate one at run time (a <select>'s value)
} from '@tomtom-org/maps-sdk-plugin-map-theme';
```

## Derive, then apply

```ts
const styling = await StylingFoundationsModule.get(map);
const colors = deriveMapColors(['#0b2a3a', '#0fa8c8', '#f6efe3', '#d9822b']);
styling.setMapColors(colors); // `colors` has every role — show it as swatches, or correct one with setKnob(styling, stylingFoundationsKnobCatalogue, 'colors.water', …)
styling.setMapColors(await deriveMapColorsFromImage(fileInput.files[0], { mode: 'dark' })); // File, Blob, <img>, ImageBitmap, CORS-readable URL
```

Role assignment is deterministic:

| Role | Gets |
| --- | --- |
| `land` | Lightest low-saturation colour, toned to a neutral; darkest on a dark theme |
| `roadMajor` | Most colourful (OKLCH chroma), preferring one that is not a blue or a green |
| `water` / `vegetation` | A blue or cyan / a green |
| `label` | Highest contrast to `land`, only if ≥ 4.5:1 WCAG |
| `accent` | Most colourful left reading ≥ 3:1 on `land` and ≥ 30° of hue from `roadMajor`; else `roadMajor`'s complement |

`mode` is `'auto'` (default; dark when the colours' mean lightness is under 0.45), `'light'` or `'dark'` — `deriveMapColors(colors, { mode })`, and `{ mode, colorCount }` on the CSS and image functions. Roles no colour fits are `hsl()` shades of `land`, so 1–8 colours always give every role; picked colours come back as given. A derived `label` always reaches 4.5:1 against `land`, flipping to the other side of it when the mode's side cannot.

**Match the style before applying.** `setMapColors` re-derives the loaded style's own shades at its offsets, so a dark theme over `streetLight` clamps them to black. Always check, since `auto` (and an image) decide at run time:

```ts
const lightDark = mapColorsLightDark(colors); // dark when label is lighter than land
if (lightDark !== map.styleLightDarkTheme) await map.setStyle(lightDark === 'dark' ? 'streetDark' : 'streetLight');
styling.setMapColors(colors);
```

## The accent — the theme reaches the whole map

`accent` paints no base-map layer: it is published on the map (`map.mapColors`) and read as the **default** colour of what the modules draw themselves. One `setMapColors` call themes the base map and the SDK's own content together:

```ts
const routes = await RoutingModule.create(map);  // no colour chosen
const areas = await GeometriesModule.create(map);
styling.setMapColors(deriveMapColors(['#1d3f8a', '#e63312', '#f5d000', '#111111', '#f4f1ea']));
map.mapColors.accent;                             // what routes and areas draw in
```

| Module | Takes the accent | Caller's own colour, which always wins |
| --- | --- | --- |
| `RoutingModule` | route line, its outline, waypoint icons | `color`; a `layers` paint override for one layer |
| `GeometriesModule` | fill, outline | `color`, `fill.color` or `fill.palette` for both, `line.color`, a feature's `color` property |
| `ReachableRangesModule` | its bands, as a ramp from the accent (innermost) toward the map's `land` (outermost), reversed for `inverted`; follows both, and without them ramps between the style's light/dark defaults | `palette` |
| `PlacesModule` | pin, selected label, connection lines, entry points | `color` for all four; over it, `icon.default.style.fillColor`, `label.color` or `layers.selected`, `connections.layers`, `entryPoints.layers` |

- A module given no colour follows the accent live; with no accent set, each keeps its own default.
- With `PlacesModuleConfig.color` set, an accent change repaints nothing.
- A geometry `fill.palette` is your own list of colours; to match the theme, pass colours from the same `deriveMapColors` result (`[accent, water, roadMajor]`). There are no named palettes.
- Geometry colours, highest first — fill: a feature's `color`, `fill.color`, `fill.palette`, `color`, the accent; outline: `line.color`, a feature's `color`, `fill.color`, `fill.palette`, `color`, the accent — grey instead of the accent under `fill.style: 'outline'`. With no accent, the style's light/dark default: navy `#0A3653` on light, sky blue `#5FA8D8` on dark.
- Do not set a route or pin colour after theming a map: the accent already does it. Set one only when the user asks for a *specific* colour for that content.
- **Base map only**: `const { accent, ...baseMapColors } = deriveMapColors(colors); styling.setMapColors(baseMapColors);` — or `resetKnob(styling, stylingFoundationsKnobCatalogue, 'colors.accent')` to drop one already set. The modules return to their own defaults.
- **Not followers**: `CustomGeoJSONModule`, `TrafficIncidentDetailsModule`, `TrafficAreaAnalyticsModule`, your own MapLibre layers, the flyover plugin's marker, base-map POI icons, and `PlacesModule` cluster badges (`cluster.badge.color`, default black). To match, read `map.mapColors.accent` on `styling.events.on('config-change', …)` — it is up to date when the event fires.

## Recipes for a coding agent

**From a stylesheet** (a `.css` file the user uploads, a design system's tokens, CSS a server fetched): `styling.setMapColors(deriveMapColorsFromCss(cssText))` — no DOM, `await file.text()` for a `File`. It resolves `var()` against the rule's own or the page root's custom properties (not one set on another selector), weights colours by how many rules fill with them (borders and shadows less; translucent colours, a colour's hover shades and words in `url()` paths not at all), keeps at most two greys while colourful ones remain, and takes light or dark from the page background (`:root`/`html`/`body`, else the most-filled grey; light when neither resolves). Colour-scheme rules (`prefers-color-scheme`, `.dark`/`.light`, `.dark-mode`, `data-*="dark"`) are read only with that `mode` and then override the root defaults; `auto` reads neither. `@import`s are not followed: concatenate the files. `cssColors(cssText)` returns the colours to edit first.

**From a website URL.** A page cannot read another origin's CSS. With a server or a coding agent's own fetch: download the page's `<link rel="stylesheet">` files, concatenate them, and `deriveMapColorsFromCss(css)`. Otherwise *you* extract the colours:
1. Fetch the page. Collect, in this order of trust: `<meta name="theme-color">`, CSS custom properties on `:root`/`html`/`body` whose names contain `primary|accent|brand|background|surface|text`, the `background`/`color` of `body`, `header`, `nav`, `footer` and the primary button, and the fills of an SVG logo.
2. Keep 3–6 distinct colours: one background/neutral, one text colour, one or two accents, plus any obvious blue or green.
3. `styling.setMapColors(deriveMapColors(colors))`. Tell the user which site colour became which role.

**From the app's own CSS** (same origin, so the page can read it): collect `getComputedStyle(document.documentElement).getPropertyValue('--…')` for the design system's primary/accent/surface/text properties plus `<meta name="theme-color">`, then `styling.setMapColors(deriveMapColors(colors))`. Hex, `rgb()`, `hsl()` and CSS names are read; other formats are skipped.

**From an image / photo / poster.** In the app: `deriveMapColorsFromImage(file)` with a `File` from an `<input type="file">`, or a CORS-readable URL (a tainted canvas throws — then ask for the file or a CORS-enabled host). Without a DOM: decode the image yourself and pass `{ data, width, height }` (`ImagePixels`), or hand `dominantColors(pixels)` to `deriveMapColors`.

**From a described palette or mood** ("warm earthy tones", "neon cyberpunk"): write 4–6 hex colours that embody it — one neutral background, one contrasting text colour, one or two accents, a cool/green colour if the mood has one — then `deriveMapColors(colors, { mode })`. Name the colours in a comment so the user can edit them.

**From an artist or design movement** ("like Miró", "Bauhaus", "Hokusai's Great Wave"): pick 4–6 characteristic colours (Miró: cobalt `#1d3f8a`, red `#e63312`, yellow `#f5d000`, black `#111111`, off-white `#f4f1ea`; Hokusai: Prussian blue `#1f3a5f`, pale sky `#dfe6ea`, cream `#efe6cf`, sand `#c9b58a`). Force `mode` when the reference is clearly light or dark. A coherent palette in that spirit, not pixel fidelity.

## Agent-toolkit

`setMapStyling({ theme: { colors: string[] } | { imageUrl: string } })`, either with an optional `mode` — applied after `preset`, before `set`, so `set: { 'colors.water': … }` still overrides one role. `imageUrl` must be http(s). The result carries `themeColors` (role → colour), and `switchedStyle` when the theme came out the other light/dark than the loaded standard style and the tool switched to its variant (satellite is left as it is); an unreadable image lands in `rejected`, not as a tool error. There is no website tool: the LLM turns the site or mood into colours itself.

## Gotchas

- `mode: 'dark'` takes the darkest colour with an HSL saturation of 0.4 or less as `land`, and a saturated one only when none qualifies. It never invents one. So `['#ffffff', '#140b26']` keeps a white `land`, since `#140b26` is 0.55 saturated, and `mapColorsLightDark` returns `'light'`. Add a dark grey such as `#141414` when the map must stay on `streetDark`.
- `setMapColors(derived)` sets all ten and the accent; `resetKnob(styling, stylingFoundationsKnobCatalogue, 'colors.water')` returns one role to the style, `styling.resetConfig()` everything.
- Busy photos average into muted colours; raise `colorCount` (default 6) in `deriveMapColorsFromImage(image, { colorCount })`, or hand-pick from `dominantColors`.
- A stylesheet whose colours live in theme variables defined elsewhere resolves to nothing: pass the file that defines them too.
- Applied themes are `colors.*` knobs: they survive `setStyle`, read back with `getKnob(styling, stylingFoundationsKnobCatalogue, 'colors.land')` or `map.mapColors`, and serialise with `getConfig()`.
- No colour, no theme: `deriveMapColors` (nothing parses), `deriveMapColorsFromCss` throw and `deriveMapColorsFromImage` rejects with `RangeError`; an unreadable image (tainted canvas, no DOM) rejects too. Catch to keep the current colours.
