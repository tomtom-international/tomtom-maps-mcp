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

- **BREAKING**: Removed tool inputs that never reached the TomTom API, because neither the maps-sdk nor the service sent them:
  - `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`: `vehicleTypeSet`, `ext`; `tomtom-nearby` also `parkingAvailability`.
  - `tomtom-geocode`: `timeZone`.
  - `tomtom-reverse-geocode`: `limit`, `countries`, `view`, `extendedPostalCodesFor`, `timeZone`, `returnMatchType`, `returnRoadClass`, `callback`, `filter`.
  - `tomtom-routing`: `alternativeType`, `supportingPoints`, `minDeviationDistance`, `minDeviationTime`, `supportingPointIndexOfOrigin`, `reconstructionMode`, `routeRepresentation`, `extendedRouteRepresentation`; and `vehicleHeading`, until the maps-sdk can send a heading of 0 (north).
  - `tomtom-routing`, `tomtom-reachable-range`: `vehicleHasElectricTollCollectionTransponder`, `arrivalSidePreference`; `tomtom-reachable-range` also `report`, `windingness`, `hilliness`.

### Changed
- Dropped the `Orbis` qualifier from file names, types and log messages now that there is only one backend. This is internal only; tool names, tool schemas and MCP app resource URIs are unchanged.
- The MCP server now always reports its name as `TomTom Maps MCP Server`.
- `tomtom-routing` and `tomtom-reachable-range` reject vehicle inputs the API would ignore or refuse, naming them, instead of dropping them: consumption, charge, fuel and efficiency parameters without the matching `vehicleEngineType`; `currentChargeInkWh` without `maxChargeInkWh` or the reverse; a fuel level or charge without its consumption curve; and charge budgets without `maxChargeInkWh`.
- The search tools' `view`, `tomtom-routing`'s `sectionType`, the routing tools' and `tomtom-dynamic-map`'s `avoid`, and `tomtom-ev-search`'s `connectorTypes` list their valid values in the tool schema, taken from the maps-sdk. `avoid` now shows `borderCrossings`, `tunnels`, `carTrains` and `lowEmissionZones`, which it accepted but did not list. `tomtom-reachable-range`'s `avoid` leaves out `alreadyUsedRoads`, which the Reachable Range API rejects.
- Dropped the unused `jsonwebtoken`, `node-fetch` and `tslib` dependencies.
- **BREAKING**: `tomtom-reachable-range` computes only the requested budget, with one API call instead of up to four. The response holds one range, and the top-level `requestedBudgetValue` is gone. The MCP app's Range selector fetches the other budgets (0.5×–2×) when you pick them.

### Fixed
- Tool inputs that were accepted but never sent now reach the TomTom API:
  - `tomtom-ev-search` applies `minPowerKW` across all stations in range. It filtered only the first page, so where the nearest chargers were slow it returned none.
  - `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`: `minPowerKW`, `maxPowerKW`, `brandSet`, `connectorSet`, `fuelSet`, `view`, `ofs`; fuzzy search also `entityTypeSet`, `idxSet`; POI search also `boundingBox`, `typeahead` and `chargingAvailability`, which adds real-time charger availability (summarised in compact responses, as in `tomtom-ev-search`).
  - `tomtom-geocode`: `radius`, `view`, `ofs`, `entityTypeSet`.
  - `tomtom-reverse-geocode`: `returnSpeedLimit`, `allowFreeformNewLine`, `heading`, `entityType`.
  - `tomtom-routing`: every vehicle input (`vehicleMaxSpeed`, `vehicleWeight`, `vehicleEngineType`, the consumption models and efficiencies) and `sectionType`.
  - `tomtom-routing`, `tomtom-reachable-range`: `consumptionInkWhPerkmAltitudeGain` and `recuperationInkWhPerkmAltitudeLoss`.
- `tomtom-traffic` now honours its `fields` parameter.
- `tomtom-traffic`'s `categoryFilter` described the category codes wrongly (`0` as accidents, `8` as road works), so it returned other incidents than asked for. The codes now come from the maps-sdk.
- `tomtom-reachable-range` sends `currentChargeInkWh` as given. It rounded it to a whole percentage of the battery, and dropped it below 0.5%.
- `tomtom-dynamic-map` accepts a map framed by `bbox` alone, and draws route labels when `showLabels` is set.

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
