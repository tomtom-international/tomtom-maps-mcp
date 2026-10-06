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
  - `tomtom-reverse-geocode`: `limit`, `countries`, `extendedPostalCodesFor`, `timeZone`, `returnMatchType`, `returnRoadClass`, `callback`, `filter`; and `mapcodes`, `returnSpeedLimit` and `allowFreeformNewLine`, since the maps-sdk reverse geocodes on the Places API v2, which takes none of them.
  - `tomtom-routing`: `alternativeType`, `supportingPoints`, `minDeviationDistance`, `minDeviationTime`, `supportingPointIndexOfOrigin`, `reconstructionMode`, `routeRepresentation`, `extendedRouteRepresentation`.
  - `tomtom-routing`, `tomtom-reachable-range`: `vehicleHasElectricTollCollectionTransponder`, `arrivalSidePreference`; `tomtom-reachable-range` also `report`, `windingness`, `hilliness`.
  - `tomtom-dynamic-map`: `routeInfoDetail` and `center.label`.
  - `tomtom-routing`: `currentFuelInLiters` and `currentChargeInkWh`. The Routing API returns the same route whatever their values. `maxChargeInkWh` stays: it adds `batteryConsumptionInPCT` to the summary, and the tool sends the battery as full, since the API takes the battery size only together with a charge. `tomtom-reachable-range` keeps both, where they bound the budget.
- **BREAKING**: The `TOMTOM_API_BASE_URL` environment variable. Only `tomtom-traffic` read it; every tool now calls the API through the maps-sdk at `https://api.tomtom.com`.

### Changed
- Dropped the `Orbis` qualifier from file names, types and log messages now that there is only one backend. This is internal only; tool names, tool schemas and MCP app resource URIs are unchanged.
- The MCP server now always reports its name as `TomTom Maps MCP Server`.
- `tomtom-routing` and `tomtom-reachable-range` reject vehicle inputs the API would ignore or refuse, naming them, instead of dropping them: consumption, charge, fuel and efficiency parameters without the matching `vehicleEngineType`; `currentChargeInkWh` without `maxChargeInkWh` or the reverse; a fuel level or charge without its consumption curve; and charge budgets without `maxChargeInkWh`.
- Tools reject input combinations the API ignores or refuses, naming the inputs, instead of passing them on:
  - `tomtom-nearby` without `poiCategories` or a brand, fuel, connector or charging-power filter. The Search API returned no results for it.
  - `tomtom-area-search` with more than one area (`center` and `radius`, `polygon`, `boundingBox`), or with `center` or `radius` alone. Only the first area was searched.
  - `tomtom-routing` with both `departAt` and `arriveAt`. `arriveAt` was dropped.
  - `tomtom-routing` and `tomtom-reachable-range` with `accelerationEfficiency` without `decelerationEfficiency`, `uphillEfficiency` without `downhillEfficiency`, or the reverse; and, for combustion vehicles, efficiency parameters without `fuelEnergyDensityInMJoulesPerLiter`, or the reverse.
  - `tomtom-geocode`, `tomtom-fuzzy-search` and `tomtom-poi-search` with `radius` but no `position`. The radius was ignored.
  - `tomtom-reverse-geocode` with `entityType` and `heading`, which the API ignores for an `entityType` lookup.
  - `tomtom-geocode`, `tomtom-fuzzy-search` and `tomtom-poi-search` with both `position` and `boundingBox`. The maps-sdk takes one or the other.
  - `tomtom-routing` with `vehicleHeading` and a combustion vehicle, or an electric one without `maxChargeInkWh`. The maps-sdk sends a heading only with the vehicle's fuel or charge level, which a route has only for an electric vehicle with its battery size.
  - `tomtom-area-search` with a `polygon` of fewer than 3 points or a `radius` of 0, and `tomtom-routing`/`tomtom-reachable-range` with a `vehicleMaxSpeed`, `vehicleWeight` or `currentFuelInLiters` of 0, which the SDK dropped.
  - More than 10 `poiCategories`, `brandSet`, `connectorSet` or `connectorTypes` values, which the Search API refuses.
  - `tomtom-reachable-range` with more than one budget (only the first was used); with a time or distance budget and engine or consumption inputs, which such a range ignores (only `vehicleMaxSpeed` and `vehicleWeight` shape it); with an `energyBudgetInkWh` or `chargeBudgetPercent` above the current charge (the API refused it); or with a `remainingChargeBudgetPercent` at or above the current charge (it became an empty budget).
- `tomtom-routing`'s `sectionType` is described as what it is: a filter on the section types in the response. Compact responses still drop the map-rendering types.
- `tomtom-ev-routing` and `tomtom-search-along-route` accept the `thrilling` `routeType`, like `tomtom-routing`.
- `tomtom-traffic` requires `bbox` in its schema; a call without one always failed.
- `tomtom-data-viz`'s `show_ui` defaults to `true`, as its MCP app already assumed.
- The search tools' `view`, `tomtom-routing`'s `sectionType`, the routing tools' and `tomtom-dynamic-map`'s `avoid`, and `tomtom-ev-search`'s `connectorTypes` list their valid values in the tool schema, taken from the maps-sdk. `avoid` now shows `borderCrossings`, `tunnels`, `carTrains` and `lowEmissionZones`, which it accepted but did not list. `tomtom-reachable-range`'s `avoid` leaves out `alreadyUsedRoads`, which the Reachable Range API rejects.
- Dropped the unused `jsonwebtoken`, `node-fetch` and `tslib` dependencies.
- The maps-sdk is 0.64 (was 0.51):
  - **BREAKING**: `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby` and `tomtom-geocode` page with `cursor` instead of `ofs`: pass the `nextCursor` of the previous response, which compact responses now keep.
  - **BREAKING**: `poiCategories` takes the maps-sdk's current category codes, which `tomtom-poi-categories` returns. 75 codes changed, such as `GAS_STATION` (now `FUEL_STATION`), `ELECTRIC_VEHICLE_STATION` (`CHARGING_LOCATION`) and `SUPERMARKETS_HYPERMARKETS` (`SUPERMARKET`); an old code is rejected, naming it.
  - **BREAKING**: `tomtom-reverse-geocode` answers from the Places API v2. Addresses no longer carry `buildingNumber`, `street`, `streetNameAndNumber`, `routeNumbers` or `localName`, and `neighbourhood` is `neighborhood`.
  - `tomtom-traffic` calls Traffic Incident Details v2. Its `full` incidents no longer carry `tmc`.
  - `tomtom-poi-categories` returns each keyword's best-matching categories, ignoring accents: `bar` finds Bar, not the 15 categories whose names contain it.
  - Every EV place now lists its charging points under `chargingPark.chargingStations`. Compact responses drop the list, as the connectors summarise it.
  - The reachable-range app draws the range with the maps-sdk's reachable-range module and no longer offers a colour palette, which the maps-sdk dropped.
- **BREAKING**: `tomtom-traffic` calls the Traffic API through the maps-sdk, like the other tools:
  - `categoryFilter` takes a list of names (`accident`, `jam`, `road-closed`, `roadworks`, …) instead of comma-separated codes, and `timeValidityFilter` a list (`["present", "future"]`) instead of a comma-separated string.
  - `fields` is removed. The SDK always requests the fields that were its default; the only other field, `aci`, is always empty.
  - Incidents carry the SDK's names: compact responses have `category` and `magnitudeOfDelay` names (`road-closed`, `major`) and `lengthInMeters` and `delayInSeconds`, instead of `iconCategory` and `magnitudeOfDelay` codes and `length` and `delay`. `incidentSummary.incidentsByCategory` replaces `incidentsByIconCategory`. `full` returns a GeoJSON FeatureCollection instead of an `incidents` list.
  - `maxResults` still caps the incidents returned, but is no longer sent to the API, which ignored it.
- **BREAKING**: `tomtom-reachable-range` computes only the requested budget, with one API call instead of up to four. The response holds one range, and the top-level `requestedBudgetValue` is gone. The MCP app's Range selector fetches the other budgets (0.5×–2×) when you pick them.

### Fixed
- Tool inputs that were accepted but never sent now reach the TomTom API:
  - `tomtom-ev-search` applies `minPowerKW` across all stations in range. It filtered only the first page, so where the nearest chargers were slow it returned none.
  - `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`: `minPowerKW`, `maxPowerKW`, `brandSet`, `connectorSet`, `fuelSet`, `view`; fuzzy search also `entityTypeSet`, `idxSet`; POI search also `boundingBox`, `typeahead` and `chargingAvailability`, which adds real-time charger availability (summarised in compact responses, as in `tomtom-ev-search`).
  - `tomtom-geocode`: `radius`, `view`, `entityTypeSet`.
  - `tomtom-reverse-geocode`: `heading`, `entityType`, `view`.
  - `tomtom-routing`: every vehicle input (`vehicleMaxSpeed`, `vehicleWeight`, `vehicleEngineType`, `vehicleHeading`, the consumption models and efficiencies) and `sectionType`.
  - `tomtom-routing`, `tomtom-reachable-range`: `consumptionInkWhPerkmAltitudeGain` and `recuperationInkWhPerkmAltitudeLoss`.
- `tomtom-traffic`'s `categoryFilter` described the category codes wrongly (`0` as accidents, `8` as road works), so it returned other incidents than asked for. It now takes category names.
- `tomtom-reachable-range` sends `currentChargeInkWh` as given. It rounded it to a whole percentage of the battery, and dropped it below 0.5%.
- `tomtom-dynamic-map` accepts a map framed by `bbox` alone, and draws route labels when `showLabels` is set.
- `tomtom-dynamic-map` uses a `center` given without `zoom`, zooming to keep the content in view around it, and a `zoom` given without `center`; it ignored each unless both were set. It draws `routes` alongside `routePlans`, where it dropped them, and keeps a polygon `strokeWidth` of 0, which it drew as 2.
- TomTom API errors map to the key, rate-limit and server-error messages again for every tool. Errors from the maps-sdk other than a 403 ended as unknown errors, and `tomtom-data-viz` reported a failing `data_url` as a TomTom API key or server problem.
- Tool descriptions that stated wrong defaults: the search tools' `limit` (10, not 5; `tomtom-nearby` 20), `tomtom-ev-search`'s `radius` (no default; without it there is no distance limit) and `tomtom-ev-routing`'s `batteryCurve`.

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
