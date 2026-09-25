# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **BREAKING**: The server always uses the TomTom Orbis Maps APIs. The TomTom Maps (Genesis) tool set is no longer registered.
  - Stdio, npx and Docker users who did not set `MAPS` were on TomTom Maps and move to TomTom Orbis Maps. Tool inputs and outputs change for them:
    - coordinates are `[lon, lat]` arrays instead of `{lat, lon}` objects;
    - `tomtom-routing` takes `locations[]` instead of `origin`/`destination`;
    - `routeType` values are `fast`/`short`/`efficient`/`thrilling`, and `traffic` is `live`/`historical`;
    - search responses are GeoJSON FeatureCollections.
  - `tomtom-static-map` is removed. Use `tomtom-dynamic-map`.
  - `tomtom-waypoint-routing` is removed. `tomtom-routing` accepts two or more `locations`.
  - New for users who were on TomTom Maps: `tomtom-poi-categories`, `tomtom-area-search`, `tomtom-ev-search`, `tomtom-search-along-route`, `tomtom-ev-routing` and `tomtom-data-viz`.
  - TomTom Orbis Maps is in Public Preview. API keys without Orbis access get 403 errors; see [Forbidden (403) Errors](README.md#forbidden-403-errors).
- **BREAKING**: the `MAPS` environment variable and the `tomtom-maps-backend` HTTP header are not recognised. `MAPS` has no effect and logs nothing. The header is not in the CORS allow-list, so a browser client that still sends it fails preflight; remove it from the client configuration.
- The server name is always `TomTom Maps MCP Server`.
- `/health` returns only `status` and `version`.
- The MCPB extension no longer has a "Maps Backend" setting.
- **BREAKING**: Renamed `MAPS` environment variable values from `genesis`/`orbis` to `tomtom-maps`/`tomtom-orbis-maps`
  - If you were using `MAPS=genesis`, update to `MAPS=tomtom-maps`
  - If you were using `MAPS=orbis`, update to `MAPS=tomtom-orbis-maps`
  - The default value is now `tomtom-maps` (previously `genesis`)

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
