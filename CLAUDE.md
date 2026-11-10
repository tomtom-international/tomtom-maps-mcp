# UX branch: MCP Apps

This branch is for improving how the TomTom MCP Apps look and feel. The apps are the interactive maps the MCP server shows inside Claude, ChatGPT and other AI clients. Change the UI and UX only, never what the apps or the server do. Load the `tomtom-mcp-ux` skill before any UI work.

## Run it

```
pnpm install
pnpm ux:dev
```

Open http://localhost:8080, pick a tool, press Run. The app renders inside a Claude-like chat. Save a file under `src/apps/` and the open app reloads within a couple of seconds, on the same data and without a new API call. Press Run again for fresh data. `.env` needs `TOMTOM_API_KEY` (the team key).

## What you may change

Presentation anywhere under `src/apps/`:
- `styles.css`, `app.html`, the popup markup and styles in `src/apps/shared/*-popup.ts`, `ui-visibility.css`
- colours, sizes, opacity, fonts, icons, labels, spacing, layout and control positions in any `src/apps/**` file
- map look through the Maps SDK's config: style, layer visibility, line and fill styling (use the `tomtom-maps-sdk-js` skill)

## What you must not change

- anything outside `src/apps/`: `src/services`, `src/handlers`, `src/schemas`, `src/tools`, tests, CI
- which tools an app calls, or the order it calls them (`callServerTool`, `tomtom-get-api-key`, `tomtom-get-app-config`, `tomtom-get-app-data`, `tomtom-report-app-status`)
- how an app reads the tool result: `src/apps/shared/appData.ts`, `sdk-parsers.ts`, which features it shows, fallback and error handling
- dependencies: `package.json`, `pnpm-lock.yaml`
- the local dev tooling: `ui/`, `scripts/watch-apps.ts`, this file, `.claude/`

If a UI idea needs one of these, stop and tell the user it needs an engineer.

## Before you commit

1. `npx vitest run src/apps src/createServer.appContract.test.ts`: all green, no test edited to make it pass.
2. Run the `tomtom-mcp-preflight` commit tier as the commit gate asks.
3. Commit with a Conventional Commits message, e.g. `style(dynamic-map): softer map control shadows`.

## Before you push

Run the preflight push tier but skip its docs-portal step: no PR in `devportal-documentation` from this branch. Never open a pull request, run `tomtom-mcp-review` in PR mode, or comment on GitHub. A maintainer does all of that.

## Before merging to main (maintainer only)

Agents working for designers: ignore this section. The maintainer opens the PR to `main` from a branch with only the UX changes, after:
- `git checkout main -- ui/ package.json` (drops the Claude-like host and the `ux:dev` script)
- `git rm CLAUDE.md scripts/watch-apps.ts`
- `git rm -r .claude/skills/tomtom-mcp-ux`
- checking the diff touches only presentation under `src/apps/`
