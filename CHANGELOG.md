# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **BREAKING**: Removed tool inputs that never reached the TomTom API, because neither the maps-sdk nor the service sent them:
  - `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`: `vehicleTypeSet`, `ext`; `tomtom-nearby` also `parkingAvailability`.
  - `tomtom-geocode`: `timeZone`.
  - `tomtom-reverse-geocode`: `limit`, `countries`, `extendedPostalCodesFor`, `timeZone`, `returnMatchType`, `returnRoadClass`, `callback`, `filter`; and `mapcodes`, `returnSpeedLimit` and `allowFreeformNewLine`, since the maps-sdk reverse geocodes on the Places API v2, which takes none of them.
  - `tomtom-routing`: `alternativeType`, `supportingPoints`, `minDeviationDistance`, `minDeviationTime`, `supportingPointIndexOfOrigin`, `reconstructionMode`, `routeRepresentation`, `extendedRouteRepresentation`.
  - `tomtom-routing`, `tomtom-reachable-range`: `vehicleHasElectricTollCollectionTransponder`, `arrivalSidePreference`; `tomtom-reachable-range` also `report`, `windingness`, `hilliness`.
  - `tomtom-dynamic-map`: `routeInfoDetail` and `center.label`.
- **BREAKING**: The `TOMTOM_API_BASE_URL` environment variable. Only `tomtom-traffic` read it; every tool now calls the API through the maps-sdk at `https://api.tomtom.com`.
- **BREAKING**: EV route planning, vehicle consumption models and real-time charger availability, which the maps-sdk 1.0 no longer offers:
  - The `tomtom-ev-routing` tool and its MCP app. Charging stops are no longer planned; use `tomtom-routing` for the route and `tomtom-ev-search` for chargers.
  - `tomtom-routing` and `tomtom-reachable-range` describe the vehicle with `vehicleMaxSpeed` and `vehicleWeight` only, plus `tomtom-routing`'s `vehicleHeading`. `vehicleEngineType`, `currentChargeInkWh`, `maxChargeInkWh`, `constantSpeedConsumptionInkWhPerHundredkm`, `auxiliaryPowerInkW`, `constantSpeedConsumptionInLitersPerHundredkm`, `currentFuelInLiters`, `auxiliaryPowerInLitersPerHour`, `fuelEnergyDensityInMJoulesPerLiter`, `accelerationEfficiency`, `decelerationEfficiency`, `uphillEfficiency`, `downhillEfficiency`, `consumptionInkWhPerkmAltitudeGain` and `recuperationInkWhPerkmAltitudeLoss` are removed, and route summaries no longer carry battery or fuel consumption.
  - `tomtom-reachable-range` takes a time or distance budget only. `chargeBudgetPercent`, `remainingChargeBudgetPercent`, `energyBudgetInkWh` and `fuelBudgetInLiters` are removed, with the `budget_fuel_l`, `budget_charge_pct` and `budget_remaining_charge_pct` geometry join keys.
  - `tomtom-ev-search`'s `includeAvailability` and `tomtom-poi-search`'s `chargingAvailability`. Charging stations still list their connectors and power, without their real-time status.

### Changed
- The HTTP server gzips MCP App templates for clients that accept gzip, which cuts a map app from about 0.7 MB to about 0.2 MB on the wire. A `resources/read` is now answered as plain JSON instead of an event stream, which the SDK marks `no-transform`. Other responses stay uncompressed, as tool results can hold a secret next to caller-supplied text.
- An OAuth request that cannot call the TomTom API (`initialize`, `tools/list`, `resources/list`, `resources/read`, `ping`, notifications) no longer exchanges the bearer token for an API key. The token is still verified on every request. A token without access to the API now connects, and fails at its first tool call with the 502 it used to get when connecting. Inside an HTTP request, the server's own `TOMTOM_API_KEY` is never used in place of the request's key.
- The search tools, `tomtom-search-along-route` and `tomtom-routing` share one MCP app, `ui://tomtom-map/places-and-routes/app.html`, in place of ten (`ui://tomtom-search/<tool>/app.html` and `ui://tomtom-routing/route-planner/app.html`, which are gone). A host reads every app's HTML while connecting, one after another, so it now reads 5 apps instead of 14. The app tells results apart by their shape. The EV and area search maps gain the traffic toggles the other maps have, and their POI popups show the place name at the size the other maps use.
- `OAUTH_AUDIENCE` (comma-separated) makes the HTTP server reject bearer tokens issued for any other audience. Unset, the audience is not checked and the server logs a warning at startup.
- Tools reject input combinations the API ignores or refuses, naming the inputs, instead of passing them on:
  - `tomtom-nearby` without `poiCategories` or a brand, fuel, connector or charging-power filter. The Search API returned no results for it.
  - `tomtom-area-search` with more than one area (`center` and `radius`, `polygon`, `boundingBox`), or with `center` or `radius` alone. Only the first area was searched.
  - `tomtom-routing` with both `departAt` and `arriveAt`. `arriveAt` was dropped.
  - `tomtom-geocode`, `tomtom-fuzzy-search` and `tomtom-poi-search` with `radius` but no `position`. The radius was ignored.
  - `tomtom-reverse-geocode` with `entityType` and `heading`, which the API ignores for an `entityType` lookup.
  - `tomtom-geocode`, `tomtom-fuzzy-search` and `tomtom-poi-search` with both `position` and `boundingBox`. The maps-sdk takes one or the other.
  - `tomtom-area-search` with a `polygon` of fewer than 3 points or a `radius` of 0, and `tomtom-routing`/`tomtom-reachable-range` with a `vehicleMaxSpeed` or `vehicleWeight` of 0, which the SDK dropped.
  - More than 10 `poiCategories`, `brandSet`, `connectorSet` or `connectorTypes` values, which the Search API refuses.
  - `tomtom-reachable-range` with more than one budget. Only the first was used.
- `tomtom-routing`'s `sectionType` is described as what it is: a filter on the section types in the response. Compact responses still drop the map-rendering types.
- `tomtom-search-along-route` accepts the `thrilling` `routeType`, like `tomtom-routing`.
- `tomtom-traffic` requires `bbox` in its schema; a call without one always failed.
- `tomtom-data-viz`'s `show_ui` defaults to `true`, as its MCP app already assumed.
- The search tools' `view`, `tomtom-routing`'s `sectionType`, the routing tools' and `tomtom-dynamic-map`'s `avoid`, and `tomtom-ev-search`'s `connectorTypes` list their valid values in the tool schema, taken from the maps-sdk. `avoid` now shows `borderCrossings`, `tunnels`, `carTrains` and `lowEmissionZones`, which it accepted but did not list. `tomtom-reachable-range`'s `avoid` leaves out `alreadyUsedRoads`, which the Reachable Range API rejects.
- Dropped the unused `jsonwebtoken`, `node-fetch` and `tslib` dependencies.
- The map MCP apps load MapLibre GL JS from jsDelivr (`https://cdn.jsdelivr.net/npm/maplibre-gl@<version>/`, pinned to the installed version) instead of bundling it, which cuts each map app's HTML from about 2.3 MB to about 0.7 MB. The apps' CSP declares `https://cdn.jsdelivr.net` in place of `https://unpkg.com`, so a map app no longer renders where the client cannot reach jsDelivr.
  - The dynamic-map app no longer loads the MapLibre 4 stylesheet from unpkg, which kept the maps-sdk from applying the stylesheet of the MapLibre it runs.
- The maps-sdk is 1.0.0-rc.1 (was 0.51):
  - **BREAKING**: `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby` and `tomtom-geocode` page with `cursor` instead of `ofs`: pass the `nextCursor` of the previous response, which compact responses now keep. `tomtom-ev-search` takes `cursor` too.
  - **BREAKING**: `poiCategories` takes the maps-sdk's current category codes, which `tomtom-poi-categories` returns. 75 codes changed, such as `GAS_STATION` (now `FUEL_STATION`), `ELECTRIC_VEHICLE_STATION` (`CHARGING_LOCATION`) and `SUPERMARKETS_HYPERMARKETS` (`SUPERMARKET`); an old code is rejected, naming it.
  - **BREAKING**: `tomtom-reverse-geocode` answers from the Places API v2. Addresses no longer carry `buildingNumber`, `street`, `streetNameAndNumber`, `routeNumbers` or `localName`, `neighbourhood` is `neighborhood`, and a position with no address nearby returns a feature without `properties`.
  - `tomtom-traffic` calls Traffic Incident Details v2. Its `full` incidents no longer carry `tmc`.
  - `tomtom-poi-categories` returns each keyword's best-matching categories, ignoring accents: `bar` finds Bar, not the 15 categories whose names contain it.
  - Every EV place now lists its charging points under `chargingPark.chargingStations`. Compact responses drop the list, as the connectors summarise it.
  - The reachable-range app draws the range with the maps-sdk's reachable-range module and no longer offers the named colour palettes, which the maps-sdk dropped.
  - The reachable-range app's style list takes the maps-sdk's style names: `streetLight`, `streetDark`, `streetLightDriving`, `streetDarkDriving`, `streetSatellite`, `monoLight` and `monoDark`.
- **BREAKING**: `tomtom-traffic` calls the Traffic API through the maps-sdk, like the other tools:
  - `categoryFilter` takes a list of names (`accident`, `jam`, `road-closed`, `roadworks`, …) instead of comma-separated codes, and `timeValidityFilter` a list (`["present", "future"]`) instead of a comma-separated string.
  - `fields` is removed. The SDK always requests the fields that were its default; the only other field, `aci`, is always empty.
  - Incidents carry the SDK's names: compact responses have `category` and `magnitudeOfDelay` names (`road-closed`, `major`) and `lengthInMeters` and `delayInSeconds`, instead of `iconCategory` and `magnitudeOfDelay` codes and `length` and `delay`. `incidentSummary.incidentsByCategory` replaces `incidentsByIconCategory`. `full` returns a GeoJSON FeatureCollection instead of an `incidents` list.
  - `maxResults` still caps the incidents returned, but is no longer sent to the API, which ignored it.
### Fixed
- Tool inputs that were accepted but never sent now reach the TomTom API:
  - `tomtom-ev-search` applies `minPowerKW` across all stations in range. It filtered only the first page, so where the nearest chargers were slow it returned none.
  - `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`: `minPowerKW`, `maxPowerKW`, `brandSet`, `connectorSet`, `fuelSet`, `view`; fuzzy search also `entityTypeSet`, `idxSet`; POI search also `boundingBox` and `typeahead`.
  - `tomtom-geocode`: `radius`, `view`, `entityTypeSet`.
  - `tomtom-reverse-geocode`: `heading`, `entityType`, `view`.
  - `tomtom-routing`: every vehicle input (`vehicleMaxSpeed`, `vehicleWeight`, `vehicleHeading`) and `sectionType`.
- `tomtom-traffic`'s `categoryFilter` described the category codes wrongly (`0` as accidents, `8` as road works), so it returned other incidents than asked for. It now takes category names.
- `tomtom-dynamic-map` uses a `center` given without `zoom`, zooming to keep the content in view around it, and a `zoom` given without `center`; it ignored each unless both were set. It draws `routes` alongside `routePlans`, where it dropped them, and keeps a polygon `strokeWidth` of 0, which it drew as 2.
- TomTom API errors map to the key, rate-limit and server-error messages again for every tool. Errors from the maps-sdk other than a 403 ended as unknown errors, and `tomtom-data-viz` reported a failing `data_url` as a TomTom API key or server problem.
- Tool descriptions that stated wrong defaults: the search tools' `limit` (10, not 5; `tomtom-nearby` 20), and `tomtom-ev-search`'s `radius` (no default; without it there is no distance limit).

## [1.6.11] - 2026-10-05

### Added
- `response_detail: "geometry"` on `tomtom-routing`, `tomtom-ev-routing`, `tomtom-reachable-range`, `tomtom-traffic`, `tomtom-area-search` and `tomtom-search-along-route`. It returns the compact response plus a GeoJSON FeatureCollection of the route lines, areas or incidents, capped at 1,000 vertices per feature. The design is in [docs/adr/](docs/adr/README.md), ADRs 0001 to 0007.

### Removed
- **BREAKING**: Dropped the second ("Genesis") maps backend. All tools now run on the TomTom Orbis Maps APIs, which were the HTTP server's default; the stdio server used Genesis unless `MAPS=tomtom-orbis-maps` was set.
  - The `MAPS` environment variable and the `tomtom-maps-backend` HTTP header are no longer read. The header is also no longer in the CORS allow-list, so browser clients that still send it fail preflight.
  - The `tomtom-static-map` tool is gone; the Orbis APIs have no static-map endpoint. Use `tomtom-dynamic-map`.
  - The `tomtom-waypoint-routing` tool is gone. Use `tomtom-routing`, whose `locations` takes the origin, any stops and the destination.
  - Clients that ran on Genesis now get the Orbis tool schemas: search tools take `position` ([lon, lat]), `countries`, `boundingBox` and `poiCategories` instead of `lat`/`lon`, `countrySet`, `topLeft`/`btmRight` and `categorySet`; `tomtom-routing` takes `locations` instead of `origin`/`destination`; the truck parameters (`vehicleWidth`, `vehicleHeight`, `vehicleLoadType` and the like) are gone. They also gain `tomtom-area-search`, `tomtom-ev-search`, `tomtom-search-along-route`, `tomtom-poi-categories`, `tomtom-ev-routing` and `tomtom-data-viz`.
  - `tomtom-dynamic-map`'s `routePlans[].routeType` now takes `fast`/`short`/`efficient`/`thrilling` (was `fastest`/`shortest`/`eco`/`thrilling`), and `travelMode` accepts only `car` — matching `tomtom-routing`.
- **BREAKING**: `tomtom-dynamic-map` no longer renders a server-side image. The map is drawn by its MCP app, so the visual needs a client that supports MCP apps; other clients get a JSON summary of its view, markers, routes and areas. The `detail` parameter is removed, `show_ui` now defaults to `true`, and `width`/`height` are no longer capped at 800×600 (the schema allows up to 2048).

### Changed
- Dropped the `Orbis` qualifier from file names, types and log messages now that there is only one backend. This is internal only; tool names, tool schemas and MCP app resource URIs are unchanged.
- The MCP server now always reports its name as `TomTom Maps MCP Server`.
- **BREAKING**: `tomtom-reachable-range` computes only the requested budget, with one API call instead of up to four. The response holds one range, and the top-level `requestedBudgetValue` is gone. The MCP app's Range selector fetches the other budgets (0.5×–2×) when you pick them.
- Compact responses, the default, are about 37% smaller: they drop output that carries no information and add back fields that answer common questions.
- Tool descriptions promise only what each tool returns, name the geometry that compact responses leave out, and no longer send agents to `tomtom-dynamic-map` from the data tools.
- `tomtom-reachable-range` rejects the efficiency inputs without `vehicleWeight`, naming it. The API refuses that combination; it only seemed to work while the inputs were dropped.
- Every outbound call the HTTP server makes to authenticate a request has a deadline, so a silent upstream fails the request instead of leaving it open.
- The maps-sdk is 0.51.3 and the MCP apps run on MapLibre GL JS 6.

### Fixed
- `tomtom-reachable-range` returned the caller's TomTom API key in `full` responses and in the data its MCP app reads.
- `tomtom-ev-search` with `minPowerKW` dropped every charging station that had connector data.
- `tomtom-geocode`'s `countries` and `tomtom-reverse-geocode`'s `radius` now reach the TomTom API.
- `tomtom-reachable-range`'s `vehicleMaxSpeed`, `vehicleWeight` and efficiency inputs now reach the TomTom API.
- Clicking a place marker in the search apps opens its popup again.
- `tomtom-traffic` now honours its `fields` parameter.
- `tomtom-dynamic-map` accepts a map framed by `bbox` alone, and draws route labels when `showLabels` is set.

Versions 1.1.1 to 1.6.10 have no entry here; see the [GitHub releases](https://github.com/tomtom-international/tomtom-maps-mcp/releases) for them.

## [1.1.0] - 2025-09-18

### Added
- Added support for TomTom Orbis Maps
- New tool added `dynamic-map-tool` allows to add markers, routes and polygons on map

## [1.0.0] - 2025-06-30

### Added
- Initial open source release of TomTom MCP Server
