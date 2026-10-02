# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **BREAKING**: Dropped the second ("Genesis") maps backend. All tools now run on the TomTom Orbis Maps APIs, which were the HTTP server's default; the stdio server used Genesis unless `MAPS=tomtom-orbis-maps` was set.
  - The `MAPS` environment variable and the `tomtom-maps-backend` HTTP header are no longer read. The header is also no longer in the CORS allow-list, so browser clients that still send it fail preflight.
  - The `tomtom-static-map` tool is gone; the Orbis APIs have no static-map endpoint. Use `tomtom-dynamic-map`.
  - The `tomtom-waypoint-routing` tool is gone. Use `tomtom-routing`, whose `locations` takes the origin, any stops and the destination.
  - Clients that ran on Genesis now get the Orbis tool schemas: search tools take `position` ([lon, lat]), `countries`, `boundingBox` and `poiCategories` instead of `lat`/`lon`, `countrySet`, `topLeft`/`btmRight` and `categorySet`; `tomtom-routing` takes `locations` instead of `origin`/`destination`; the truck parameters (`vehicleWidth`, `vehicleHeight`, `vehicleLoadType` and the like) are gone. They also gain `tomtom-area-search`, `tomtom-ev-search`, `tomtom-search-along-route`, `tomtom-poi-categories`, `tomtom-ev-routing` and `tomtom-data-viz`.
  - `tomtom-dynamic-map`'s `routePlans[].routeType` now takes `fast`/`short`/`efficient`/`thrilling` (was `fastest`/`shortest`/`eco`/`thrilling`), and `travelMode` accepts only `car` — matching `tomtom-routing`.
- **BREAKING**: `tomtom-dynamic-map` no longer renders a server-side image. The map is drawn by its MCP app, so the visual needs a client that supports MCP apps; other clients get a JSON summary of its view, markers, routes and areas. The `detail` parameter is removed, `show_ui` now defaults to `true`, and `width`/`height` are no longer capped at 800×600 (the schema allows up to 2048).

### Changed
- A client that initializes without the MCP Apps extension (`io.modelcontextprotocol/ui`), such as Claude Code, no longer gets `tomtom-dynamic-map`, `tomtom-data-viz`, the app-only tools or the data tools' `show_ui` parameter: it could not draw the map, yet the results read as if it had. Claude Desktop and VS Code advertise the extension and keep every tool. The HTTP server is stateless, so it never sees a client's capabilities and keeps every tool.
- Dropped the `Orbis` qualifier from file names, types and log messages now that there is only one backend. This is internal only; tool names, tool schemas and MCP app resource URIs are unchanged.
- The MCP server now always reports its name as `TomTom Maps MCP Server`.

### Fixed
- `tomtom-traffic` now honours its `fields` parameter.
- `tomtom-dynamic-map` accepts a map framed by `bbox` alone, and draws route labels when `showLabels` is set.

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
