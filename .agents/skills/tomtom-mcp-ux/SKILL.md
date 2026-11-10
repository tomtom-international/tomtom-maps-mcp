---
name: tomtom-mcp-ux
description: "Improve how the TomTom MCP Apps look and feel on the ux/mcp-apps-vibecoding branch, without changing what they do. Use for any UI or UX request on the apps: first-time setup, running the local preview, finding which file controls a part of an app, restyling maps, popups, controls, legends and layout, and checking a change before committing."
---

# TomTom MCP Apps UX

The MCP Apps are four small web pages the TomTom MCP server shows inside AI clients such as Claude. On this branch you change only how they look and feel. The rules on what you may touch are in `CLAUDE.md` at the repository root; read them first.

## First run

1. Check Node is 22.12 or newer (`node --version`) and pnpm is available (`pnpm --version`). If pnpm is missing: `corepack enable`.
2. `pnpm install`
3. If `.env` does not exist: copy `.env.example` to `.env` and ask the user to replace `your_tomtom_api_key_here` with the team key. Never print or commit the key.
4. `pnpm ux:dev`. Ready when the log shows four `✅ <app> built in …` lines and `Host UI: http://localhost:8080`.
5. Ask the user to open http://localhost:8080, pick a tool, and press Run.

## The four apps

| App | Shown by these tools | Files |
|---|---|---|
| `map/places-and-routes` | `tomtom-routing` and every search tool (`tomtom-geocode`, `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`, …) | `src/apps/map/places-and-routes/` |
| `map/dynamic-map` | `tomtom-dynamic-map` | `src/apps/map/dynamic-map/` |
| `traffic/incidents` | `tomtom-traffic` | `src/apps/traffic/incidents/` |
| `data-viz/byod` | `tomtom-data-viz` (the host has one preset per layer type) | `src/apps/data-viz/byod/` |

Each app folder has `app.html` (page skeleton), `styles.css` (its look) and `app.ts` (map setup and behaviour). Parts shared by several apps live in `src/apps/shared/`:
- `map-controls.ts`: the theme, traffic and incidents buttons on the map
- `poi-popup.ts`, `incident-popup.ts`: popups, their markup and the styles inside them
- `ui-visibility.css`: what hides when an app is shown without its UI

Colours of drawn shapes, routes and markers sit in `app.ts` as SDK options (for example `fill: { color: "#007bff", opacity: 0.08 }`). Changing those values is fine; changing the code around them is not.

## Trying different data

Each tool in the preview has preset chips above the request box (long and short routes, many results, no results, busy and quiet traffic, and so on). Use them to see how a design holds up with different data.

When the user wants a case no chip covers ("a route from Berlin to Paris with traffic", "50 coffee shops in London"), write the JSON request for them: read the tool's schema in `src/schemas/` for the valid fields, keep `"show_ui": true`, and give them a block to paste into the request box. Coordinates are `[longitude, latitude]` unless the schema says `lat`/`lon`. Never call TomTom APIs yourself for this.

## Making a change

1. Find the file from the table above. Search for the visible text or class name if unsure.
2. Edit it. The open app reloads on its own within a couple of seconds, with the same data.
3. Ask the user to look. Iterate.
4. Before committing, run `npx vitest run src/apps src/createServer.appContract.test.ts`. If a test fails, the change altered behaviour: undo that part, never edit the test.
5. Then follow "Before you commit" in `CLAUDE.md`.

A change in `src/apps/shared/` reloads every app that uses it; check each of them.

## Map styling

For anything inside the map (base style, light and dark styles, which layers show, road and label look, traffic colours), load the `tomtom-maps-sdk-js` skill and use the SDK's options. Do not reach into raw MapLibre layers when the SDK has a setting for it.

## What the preview cannot show

The local host is close to Claude, not identical. It does not show:
- Claude's own font, exact colours and message spacing
- how ChatGPT, VS Code or other clients frame the app
- the app at Claude's real width on a phone or narrow window (resize the browser to approximate)

Tell the user when a change depends on these, so a maintainer can check it in the real client before merging.

## When to stop

Stop and tell the user an engineer is needed when the idea needs new data in the app, a different tool call, new behaviour on click beyond showing or hiding UI, a new dependency, or any file outside `src/apps/`.
