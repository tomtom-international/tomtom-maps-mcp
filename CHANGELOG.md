# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
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
