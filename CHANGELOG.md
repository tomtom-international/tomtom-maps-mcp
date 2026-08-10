# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **BREAKING**: Dropped the second ("Genesis") maps backend. All tools now run on the TomTom Orbis Maps APIs, which were already the default.
  - The `MAPS` environment variable and the `tomtom-maps-backend` HTTP header are still accepted but ignored — servers and clients that still set them keep working, they just always get the single backend.
  - The `tomtom-static-map` tool is gone; the Orbis APIs have no static-map endpoint. Use `tomtom-dynamic-map`, which renders server-side images and covers the same use case.
  - `tomtom-dynamic-map`'s `routePlans[].routeType` now takes `fast`/`short`/`efficient`/`thrilling` (was `fastest`/`shortest`/`eco`/`thrilling`), and `travelMode` accepts only `car` — matching `tomtom-routing`.

### Changed
- Dropped the `Orbis` qualifier from file names, types and log messages now that there is only one backend. This is internal only; tool names, tool schemas and MCP app resource URIs are unchanged.
- The MCP server now always reports its name as `TomTom Maps MCP Server`.

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
