# Places & Search Reference

## Imports

```ts
import {
    discoverPlaces, discoverOnePlace, geocode, geocodeOne, reverseGeocode,
    getSearchSuggestions, getPlaceDetails, geometryData,
    getPOICategories, getPOICategoryCodes, resolvePOICategories, createLatestRequest,
} from '@tomtom-org/maps-sdk/services';
import type { SearchSuggestionsParams, SearchSuggestion, PlaceSuggestion, RefinementSuggestion } from '@tomtom-org/maps-sdk/services';
import type { FuzzySearchParams, SearchFilters, PlaceFilters, GeographicFilters, DiscoverPlacesResponse } from '@tomtom-org/maps-sdk/services';
import { PlacesModule, POIsModule, GeometriesModule, setKnob, poisKnobCatalogue, placesKnobCatalogue } from '@tomtom-org/maps-sdk/map';
import type { PlaceIconConfig, PlaceLabelConfig, PlacesMarkerType, PlacesBeforeLayerConfig, MapFont } from '@tomtom-org/maps-sdk/map';
import { bboxFromGeoJSON } from '@tomtom-org/maps-sdk/core';
import { ViewportPlaces } from '@tomtom-org/maps-sdk-plugin-viewport-places';
// npm i @tomtom-org/maps-sdk-plugin-viewport-places
```

---

## Search → display on map

```ts
const placesModule = await PlacesModule.create(map);

const places = await discoverPlaces({ query: 'coffee shop', geoBias: { position: [4.9, 52.4] }, limit: 20 });
await placesModule.show(places);

// `events` covers every surface the module draws; `events.places` is the pins alone, typed as Place
placesModule.events.places.on('click', (place, lngLat) => {
    console.log(place.properties.poi?.name, place.properties.address.freeformAddress);
});

await placesModule.clear();
```

`discoverPlaces` runs all three place searches and picks one from its params: `route` → along a route,
`geometries` → inside those areas, neither → free text. There is no `alongRouteSearch`, `fuzzySearch` or
`geometrySearch` export. `discoverOnePlace('Rijksmuseum')` (a query or fuzzy params without `limit`)
resolves with the first result and throws when there is none.

---

## What `show()` takes — no mapping, and two results it doesn't

`show()` takes `Place | Place[] | Places` (`ShownPlaces`) as the service returns it — `discoverPlaces`,
`geocode`, `reverseGeocode`, `getPlaceDetails`, or your own GeoJSON
points. Never map fields by hand first.

| Result | Not a place because | Show it with |
| --- | --- | --- |
| `getSearchSuggestions` | suggestions without geometry (its autocomplete arm returns `{ context, results }`) | `await suggestion.resolve()` (place kinds) or `await suggestion.refine()` (brand/category: the follow-up search) → `show()` |
| `geometryData` | polygons | `GeometriesModule.show()` |

`preparePlacesForDisplay` is what `show()` does to each place; call it only to read what the layers,
`layers.*` overrides and click handlers see:

```ts
import { buildPlaceTitle, preparePlacesForDisplay, toPlaces } from '@tomtom-org/maps-sdk/map';

const [first] = preparePlacesForDisplay(places, { markerType: 'base-map' }).features;
// Kept: every property of the place. Added: id (also in properties, for promoteId), title,
// iconID, category + group (base-map, pin-clustered), extraFeatureProps
first.properties.title;
// An iconID naming a module-added image (default pin, categoryIcons) is the first module's;
// placesModule.getShown().places is what a given module drew

// The default label, to fall back on in your own title function
PlacesModule.create(map, { label: { title: (p) => p.properties.poi?.brands?.[0] ?? buildPlaceTitle(p) } });

// `shown-features` hands back show()'s input in whichever shape it had
placesModule.events.on('shown-features', (shown) => 'places' in shown && toPlaces(shown.places).features);
```

---

## Geocode → display on map

```ts
// Single result — throws if not found
const place = await geocodeOne('Amsterdam Centraal');
await placesModule.show(place);
const bbox = bboxFromGeoJSON(place); // undefined for an input with no extent
if (bbox) map.mapLibreMap.fitBounds(bbox);

// Multiple candidates. `filters` takes `countries` and `geographyTypes`, no POI filters
const places = await geocode({ query: 'Paris', limit: 5, filters: { countries: ['FR'] } });
const nextPage = places.properties?.nextCursor
    && (await geocode({ query: 'Paris', limit: 5, filters: { countries: ['FR'] }, cursor: places.properties.nextCursor }));
```

---

## Reverse geocode on map click

```ts
const latestLookup = createLatestRequest();

map.mapLibreMap.on('click', async (event) => {
    const lookup = await latestLookup.run((signal) => reverseGeocode({ position: event.lngLat.toArray(), signal }));
    if (!lookup.current) return;

    // With no match, the place is the queried point and carries no `properties`
    showAddressLabel(lookup.value.properties?.address?.freeformAddress);
});
```

The same `run` wraps a search re-run on `moveend` or a route planned again on each change — see
`services-config.md`.

---

## POI category search

```ts
const places = await discoverPlaces({
    filters: { poiCategories: ['PARKING_GARAGE', 'OPEN_CAR_PARKING_AREA'] },
    geoBias: { position: [4.9, 52.4] },
    limit: 50,
});
await placesModule.show(places);
```

`filters.poiCategories` accepts `POICategory` enum values (e.g. `'ITALIAN_RESTAURANT'`). Discover codes by keyword:

```ts
// Get codes matching a keyword — pass directly to search
const codes = await getPOICategoryCodes({ filters: ['restaurant'] });
const places = await discoverPlaces({ filters: { poiCategories: codes }, geoBias: { position: [4.9, 52.4] } });

// Full category objects (name, synonyms, childCategoryCodes)
const { poiCategories } = await getPOICategories({ filters: ['gym'] });
poiCategories.forEach(c => console.log(c.code, c.name));
```

Category words straight into the search — one call, any variant (`geoBias`, `geometries`, `route`):

```ts
const sushi = await discoverPlaces({ filters: { poiCategoryQuery: 'sushi' }, geoBias: { position: [4.9, 52.4] } });
const food = await discoverPlaces({ filters: { poiCategoryQuery: ['sushi', 'pizza'] }, geoBias: { position: [4.9, 52.4] } });

// Resolve first to see which words matched, then decide
const { poiCategories, unmatched } = await resolvePOICategories({ filters: ['café', 'PHARMACY', 'xyzzy'] });
```

- `filters.poiCategoryQuery` (`discoverPlaces` only, a string or an array) resolves through `resolvePOICategories`
  in the call's `language`, so it never sits beside `poiCategories` (a type error).
- `resolvePOICategories` keeps each word's best three codes, merged round-robin and capped at the 10 a search takes,
  and returns the words nothing matched in `unmatched`. A code stays itself, and codes alone skip the catalog request.
  For a picker listing every close match, use `getPOICategoryCodes` instead.
- In a search, a word nothing matches is left out; when none matches, it rejects with `SDKError` and sends no search.
  Resolve first when the caller must hear about unmatched words, or catch and retry as `query`.
- Prefer it over `query: 'sushi'` when the user names a kind of place: `query` also matches names and addresses.

`filters` ranks matches, strongest first:
- A category code matches only itself. Otherwise: an exact name or synonym, then one the keyword starts, then a
  later word, and last a substring.
- Case, accents and punctuation are ignored, and spaces too for a substring (`'bookstore'` finds `BOOK_SHOP`).
- Each keyword keeps only the matches close to its best, so `'bar'` finds `BAR`, not `NAIL_SALON` ("Nail Bar").
- Several keywords merge round-robin, each one's best match first, one entry per code. A blank keyword matches
  nothing.

---

## Search filters — everything that drops results

```ts
// Fuzzy search: `SearchFilters` = `PlaceFilters & GeographicFilters`
const dieselStations: SearchFilters = { countries: ['NL', 'BE'], poiBrands: ['Shell', 'BP'], fuelTypes: ['Diesel'] };
const stations = await discoverPlaces({ filters: dieselStations, geoBias: { position: [4.9, 52.4], radiusMeters: 20000 } });

// Geometry and along-route search: `PlaceFilters` only — `filters.countries` is a compile error there
const chargers = await discoverPlaces({
    geometries: [{ type: 'Circle', coordinates: [4.9, 52.4], radius: 5000 }],
    filters: { poiCategories: ['CHARGING_LOCATION'], connectors: ['IEC62196Type2CCS'], minPowerKW: 50 },
});

// Geocoding: `countries` and `geographyTypes`, no POI filters
const cities = await geocode({ query: 'Utrecht', filters: { countries: ['NL'], geographyTypes: ['Municipality'] } });
```

- `PlaceFilters` members: `poiCategories`, `poiBrands`, `indexes`, `geographyTypes`, `connectors`, `fuelTypes`,
  `minPowerKW`, `maxPowerKW`. `GeographicFilters`: `countries` (ISO alpha-2 or alpha-3), fuzzy search and geocoding only.
- A filter **excludes**: a non-matching place is dropped, not ranked lower. Values within one member are OR'd;
  members are AND'd.
- `geoBias` stays top-level: where to look, not what to accept.
- `getSearchSuggestions()` has its own `filters` vocabulary (`kinds`, `poiTypes`, `areaTypes`, `boundingBox`,
  `countries`) — see [Search suggestions](#search-suggestions--places-brands-and-categories-for-a-search-box).
- `getPOICategories()` and `getPOICategoryCodes()` take `filters` as keyword strings that pick categories — see
  [POI category search](#poi-category-search).

---

## Search within a boundary (geocode → geometry → search)

```ts
const area = await geocodeOne('Paris, France');
// `geometries`: places (Place[] or Places), or geometry ids (string[]) — not a single Place
const boundary = await geometryData({ geometries: [area], zoom: 10 });

const places = await discoverPlaces({
    filters: { poiCategories: ['ITALIAN_RESTAURANT'] },
    geometries: [boundary], // PolygonFeatures, Polygon, MultiPolygon or Circle; only each outer ring is sent (holes ignored), sampled to 50 vertices
    limit: 100,
});

const placesModule = await PlacesModule.create(map);
const geometriesModule = await GeometriesModule.create(map, { fill: { style: 'inverted' } });

await geometriesModule.show(boundary);
await placesModule.show(places);
if (boundary.bbox) map.mapLibreMap.fitBounds(boundary.bbox);
```

---

## Search within a circle or bounding box

```ts
// Circle
const inCircle = await discoverPlaces({
    query: 'restaurant',
    geometries: [{ type: 'Circle', coordinates: [4.9, 52.4], radius: 2000 }], // radius in meters
});

// Bounding box: a fuzzy search biased to it
const inBox = await discoverPlaces({
    filters: { poiCategories: ['BUS_STOP'] },
    geoBias: { boundingBox: [4.72, 52.27, 5.07, 52.43] }, // [west, south, east, north]
});
```

---

## Along-route search — find POIs along a planned route

`discoverPlaces()` dispatches to along-route search when a `route` parameter is provided.

**Route input** accepts three forms:
- `Route` Feature from `calculateRoute` (most common)
- `LineString` GeoJSON geometry
- `Position[]` — plain array of `[longitude, latitude]` pairs

```ts
import { calculateRoute, geocodeOne, discoverPlaces } from '@tomtom-org/maps-sdk/services';
import type { Waypoint } from '@tomtom-org/maps-sdk/core';

// Most common: use a Route Feature from calculateRoute
const waypoints: Waypoint[] = await Promise.all(['Amsterdam', 'Utrecht'].map(geocodeOne));
const routes = await calculateRoute({ locations: waypoints });

const evStations = await discoverPlaces({
    route: routes.features[0],          // Route Feature
    maxDetourTimeSeconds: 600,          // required — positive integer
    filters: { poiCategories: ['CHARGING_LOCATION'] },
    limit: 10,
});

// Or pass a LineString geometry directly
const cafes = await discoverPlaces({
    route: routes.features[0].geometry, // LineString
    maxDetourTimeSeconds: 300,
    query: 'cafe',
    sortBy: 'detourOffset',             // 'detourTime' | 'detourOffset'
});

// Or pass a plain coordinate array
const stops = await discoverPlaces({
    route: [[4.9, 52.37], [4.95, 52.28], [5.1, 52.09]], // Position[]
    maxDetourTimeSeconds: 600,
    filters: { poiCategories: ['FUEL_STATION'] },
});
```

**Display on map:**

```ts
const placesModule = await PlacesModule.create(map);
await placesModule.show(evStations);
```

**Parameters unique to along-route search:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `route` | Yes | `Route \| LineString \| Position[]` — the route to search along |
| `maxDetourTimeSeconds` | Yes | Max allowed detour in seconds (positive integer) |
| `sortBy` | No | `'detourTime'` (default) or `'detourOffset'` (position along route) |

All common search parameters (`query`, `filters`, `limit`, `language`, etc.) also apply, except `filters.countries` and `cursor` — see [Search filters](#search-filters--everything-that-drops-results) and [Pagination](#pagination--opaque-cursor).

**Gotcha:** `route` and `geometries` are mutually exclusive — do not pass both.

---

## Place details — full details with opening hours

```ts
const place = await getPlaceDetails({
    entityId: feature.properties.id,
    openingHours: 'nextSevenDays',
});

if (place) {
    const hours = place.properties.poi?.openingHours;
    if (hours?.alwaysOpenThisPeriod) {
        console.log('Open 24/7');
    } else {
        hours?.timeRanges.forEach(({ start, end }) => {
            console.log(`${start.date.toLocaleString()} – ${end.date.toLocaleString()}`);
        });
    }
}
```

**Pattern: map POI click → fetch details**

```ts
const poisModule = await POIsModule.get(map);

poisModule.events.on('click', async (feature) => {
    const place = await getPlaceDetails({
        entityId: feature.properties.id,
        openingHours: 'nextSevenDays',
    });
    if (place) showDetailsPanel(place);
});
```

---

## EV charging stations — search and read

Search results (`discoverPlaces`, geometry and along-route search, `getPlaceDetails`) describe the
hardware on `place.properties.chargingPark`. The SDK has no real-time availability: there is no
live status per charging point or connector.

```ts
const stations = await discoverPlaces({
    filters: { poiCategories: ['CHARGING_LOCATION'], connectors: ['IEC62196Type2CCS'], minPowerKW: 50 },
    geoBias: { position: [4.9, 52.4] },
});
await placesModule.show(stations);
```

- `connectors: ConnectorCount[]` — `{ connector, count }` per connector type and power; `connector` has
  `type`, `ratedPowerKW`, `chargingSpeed`, `currentType`, `voltageV`, `currentA`.
- `chargingStations?: ChargingStation[]` — each station's `id` and `chargingPoints`: one per
  EVSE, with `capabilities`, `restrictions`, optional `connectors` and optional `evseId` (some operators publish
  none — guard it). Only one connector of a point charges at a time.

```ts
const [station] = stations.features;
const { chargingPark } = station.properties;
chargingPark?.connectors.forEach(({ connector, count }) =>
    console.log(`${count} × ${connector.type}, ${connector.ratedPowerKW} kW (${connector.chargingSpeed})`));
chargingPark?.chargingStations?.forEach((chargingStation) =>
    chargingStation.chargingPoints.forEach((point) =>
        console.log(point.evseId ?? chargingStation.id, point.connectors?.map((connector) => connector.type))));
```

---

## POIsModule — filter and interact with map's built-in POIs

```ts
const poisModule = await POIsModule.get(map, { visible: true });

poisModule.updateConfig({ filters: { categories: { show: 'all-except', values: ['FOOD_DRINKS_GROUP', 'PARKING_GROUP'] } } });
poisModule.updateConfig({ filters: undefined }); // reset
poisModule.setVisible(false);

poisModule.events.on('click', (feature, lngLat) => {
    // feature.properties: id (a place id for getPlaceDetails), name, category, group, priority —
    // category and group are the style's lower-case values ('restaurant', 'eat_and_drink'), not POICategory codes
});
```

`POIsModule.get` returns the map's one shared instance (the POIs belong to the style); a config passed to a later `get` replaces the one it holds, as `applyConfig` does. `events.off(type)`
removes every handler of that type; `on` returns an unsubscribe function for one.

Category groups: `FOOD_DRINKS_GROUP`, `SHOPPING_GROUP`, `TRANSPORTATION_GROUP`, `HEALTH_GROUP`, `PARKING_GROUP`, `HOLIDAY_TOURISM_GROUP`, `EV_CHARGING_STATIONS_GROUP`, `GAS_STATIONS_GROUP`, `ACCOMMODATION_GROUP`, `ENTERTAINMENT_GROUP`, `EDUCATION_GROUP`, `GOVERNMENT_GROUP`, `SPORTS_LEISURE_GROUP`

### Custom icons per POI category — `icon.categoryIcons`

```ts
// One list for the map's own POIs and for the places a PlacesModule shows
const categoryIcons = [
    { id: 'RESTAURANT', image: restaurantSvg },
    { id: 'HOTEL_OR_MOTEL', image: hotelPinSvg, offsetY: -17 }, // a 34 px tall pin, tip on the POI
];
poisModule.updateConfig({ icon: { categoryIcons } });
searchResults.updateConfig({ icon: { categoryIcons } });
poisModule.updateConfig({ icon: undefined }); // the style's icons again
```

- An entry reaches its whole map category (`CAFE` and `CAFE_PUB` are both cafés on the map; first entry wins). Unlisted categories keep the style's icon.
- Drawn centred at the style's icon size, the module's `sizeFactor` included; `offsetX` / `offsetY` in pixels.
- Entries without `image` change nothing; micro markers keep the style's dots.
- Survives `setStyle`; `setStyle(style, { resetState: true })` drops it.
- Not a knob (it takes images), so it is absent from `poisKnobCatalogue`.

### Every knob as data — `poisKnobCatalogue`

The `POIsModuleConfig` settings a knob holds, static and readable with no map; `poisKnobIds`
lists them, `POIsKnobId` is their union.

- `visible`: toggle, default `true`.
- `filters.categories.show`: enum, `only` or `all-except`; set it with
  `filters.categories.values`, enums over the `poiCategoryGroups` names, then every
  `MapStylePOICategory`. Both have no default: unset, every category shows.
  `updateConfig({ filters: { categories } })` sets the pair at runtime; `filters` holds only `categories`.
- `sizeFactor`: factor 0.5–1.5, default `1` — the POI icons and their labels.
- `minZoom`: number 3–18 — the zoom POIs appear from; unset, the style's (6). The micro markers keep their own.
- `zoomShift`: number −3–3, default `0` — `+` shows each POI later (sparser), `−` earlier (denser).
- `label.color`, `label.haloColor`: color — `label.color` replaces the per-category label colours.
- `microMarkers.visible`: toggle — the small dot markers for low-priority POIs at high zoom.
- Entry shape and kinds: `map-setup.md` § Every setting as data.

### Appearance — size, density and label colours

```ts
const poisModule = await POIsModule.get(map, {
    sizeFactor: 1.2,
    minZoom: 12,
    label: { color: '#334155', haloColor: '#ffffff' },
    microMarkers: { visible: false },
});
setKnob(poisModule, poisKnobCatalogue, 'zoomShift', 1);
```

- `sizeFactor` multiplies with `StylingFoundationsModule`'s `labels.sizeFactor` and `symbols.sizeFactor` on the POI layers.
- `zoomShift` rewrites the POI layer filter `filters.categories` also narrows; the two compose, in either order.
- `microMarkers.visible` only hides: `true` never shows the dots while the module is hidden.
- `PlacesModule`'s `base-map` markers follow `sizeFactor`, `label.color` and `label.haloColor`; `circle-icon` and `pin-clustered` follow `sizeFactor` (`map-styling.md` § Borrowed looks).
- Map-wide colour ids, for `getStyleColor(map, id)` and `bloom.only`: `pois.label.color`, `pois.label.haloColor`.

---

## ViewportPlaces — live search as map moves

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-viewport-places`.

```ts
const viewportPlaces = new ViewportPlaces(map);

// Base-map POI categories (same icons as the map, but interactive)
await viewportPlaces.addPOICategories({
    id: 'ev-stations',
    categories: ['CHARGING_LOCATION'],
    minZoom: 10,
    maxZoom: 17, // outside the range: places cleared, no request
});

// Any fuzzy search options but geoBias, cursor and signal, which the plugin sets; resolves with the PlacesModule
const restaurants = await viewportPlaces.add({
    id: 'restaurants', // generated when left out
    searchOptions: { filters: { poiCategories: ['ITALIAN_RESTAURANT'] }, limit: 50 }, // limit default 100
    minZoom: 12,
    placesModuleConfig: { markerType: 'pin' }, // default markerType 'base-map'
});
restaurants.events.places.on('click', (place) => console.log(place.properties.poi?.name));

// Merges into the current searchOptions, `filters` member by member (the category stays);
// placesModuleConfig merges one level deep; searches again at once
await viewportPlaces.update({ id: 'restaurants', searchOptions: { limit: 30, filters: { poiBrands: ['Vapiano'] } } });
viewportPlaces.remove('restaurants'); // update and remove both throw for an unknown ID
viewportPlaces.removeAll();
```

- Searches on every `moveend`, biased to `map.getBBox()`, first page only; a newer move cancels the
  search in flight. Modules stack in the order added, the first at the bottom.

---

## Multiple PlacesModule instances — different styling per category

```ts
const restaurants = await PlacesModule.create(map, { color: '#e74c3c' });
const hotels      = await PlacesModule.create(map, { color: '#3498db' });

await restaurants.show(await discoverPlaces({ filters: { poiCategories: ['RESTAURANT'] }, geoBias: { position } }));
await hotels.show(await discoverPlaces({ filters: { poiCategories: ['HOTEL_OR_MOTEL'] }, geoBias: { position } }));
```

---

## PlacesModule — marker types and styling

### Marker type

```ts
// At init time
const places = await PlacesModule.create(map, { markerType: 'base-map' });
// Marker types (placesMarkerTypes): 'pin' | 'circle-icon' | 'base-map' | 'pin-clustered' (default: 'pin')
// - 'pin': classic teardrop pin markers
// - 'circle-icon': centered circular POI icons (same sprites as base-map's POI layer)
// - 'base-map': full base-map POI styling (POI + POI - Micro at the respective zooms).
//   To render micro-only, hide `main` via `layers.main.layout.visibility = 'none'`.
// - 'pin-clustered': pins that merge into a counted cluster up to zoom 17 by default (see below)

// At runtime
places.updateConfig({ markerType: 'pin' });
places.updateConfig({ markerType: 'circle-icon' });
places.updateConfig({ markerType: 'base-map' });
```

`base-map`, `circle-icon` and `pin-clustered` borrow the style's POI look, so the POI styling knobs restyle them live; which knobs per marker type, and what wins over them: `map-styling.md` § Borrowed looks.

### Clusters (`pin-clustered`)

`cluster` is read only under `markerType: 'pin-clustered'`. `badge` styles the count badge of single-category
and mixed-category clusters together; a `layers.clusterBadge` / `clusterCount` / `clusterMixedBadge` /
`clusterMixedCount` override still wins over it, for the paint and layout keys it names only.

```ts
const places = await PlacesModule.create(map, {
    markerType: 'pin-clustered',
    // cluster.source.properties aggregate feature properties, so the per-place value comes from here
    extraFeatureProps: {
        connectorCount: (place) =>
            place.properties.chargingPark?.connectors.reduce((total, { count }) => total + count, 0) ?? 0,
    },
    cluster: {
        // defaults: color '#000000', outlineColor '#FFFFFF', radius { single: 11, mixed: 15 }, offset [12, -14]
        badge: { color: '#3f9cd9', radius: { single: 13, mixed: 18 } },
        // MapLibre's cluster options without their `cluster` prefix; defaults radius 60, maxZoom 17
        source: {
            radius: 100,
            maxZoom: 14,
            properties: { connectors: ['+', ['get', 'connectorCount']] },
        },
    },
    // aggregated values land on the cluster feature's properties
    layers: { clusterCount: { layout: { 'text-field': ['get', 'connectors'] } } },
});
```

- Changing `source` with `applyConfig` recreates the places source.
- Clustering has no switch of its own (the marker type turns it on), and the `clusterBaseMapIconIDs` key of `properties` is reserved.

### Showing and hiding

```ts
const places = await PlacesModule.create(map, { visible: false }); // default: true
await places.show(results);  // loaded, not drawn
places.setVisible(true);     // places, connections and entry points together
places.isVisible();          // true — the flag, not whether anything is shown
```

- `show()` / `clear()` never flip it; it survives a style change. Hide with `setVisible(false)`,
  not `clear()` (drops the data) or `layers.*.layout.visibility` (one layer only).
- Showing keeps layers the marker type does not use and any `layers.*.layout.visibility: 'none'` override hidden.

### MapLibre layer paint overrides

```ts
const places = await PlacesModule.create(map, {
    markerType: 'base-map',
    layers: {
        main:     { paint: { 'text-color': '#AA0000', 'icon-opacity': 0.75 } },
        selected: { paint: { 'text-color': 'red' } },
        // zoom-based visibility:
        // main: { minzoom: 15 }
    },
});
```

A `layers.*` override wins over `label` and `color` for the layout and paint properties it names.

### Colour

```ts
const places = await PlacesModule.create(map, { color: '#2A9D8F' });
```

`color` paints the module's own drawing: the default pin, the selected label, connection lines and entry points (connection labels take a darker shade on a light map and a lighter one on a dark map; entry points take the darker one on a light map; `connections.color`, `connections.label.color` and `connections.label.haloColor` override the connections' line, label and halo). Precedence per element: `icon.default.style.fillColor` / `label.color` / a `layers` paint override > `color` > the map's accent (`colors.accent`, see `map-theming.md`) > the SDK's own colours. With `color` set, an accent change repaints nothing. `icon.default.image` replaces the pin, and neither its `style` nor the image's offsets then apply. Cluster badges do not take it: `cluster.badge.color` sets them.

### Layer positioning — `beforeLayerConfig`

Default: the markers above the map's layers, the connection lines below its labels. `beforeLayerConfig` (`PlacesBeforeLayerConfig`) takes one target (`'top'` or a `mapStyleLayerIDs` key) for everything the module draws, or a record keyed by part plus `all` for the parts it leaves out. The parts are named after the event scopes:

- `places` — markers and their labels, selected places, clusters with their badges and counts, entry points; the small POI dots of `base-map` / `pin-clustered` (below the map's place labels by default) go right under the markers once a target is set
- `connections` — the `showConnections` lines and their labels

```ts
const places = await PlacesModule.create(map, { beforeLayerConfig: { places: 'lowestLabel' } }); // pins under the map's labels
places.updateConfig({ beforeLayerConfig: 'top' }); // restacks at runtime, survives setStyle; resetConfig() restores the defaults
```

A part keeps its own layers' order; sharing a target, the connections stay under the markers. A target the style lacks (satellite has no `lowestRoadLine`) puts the part on top.

### Custom category icons

```ts
import myLogo from './myLogo.png';

const iconConfig: PlaceIconConfig = {
    categoryIcons: [
        { id: 'CHARGING_LOCATION', image: myLogo, pixelRatio: 1 },
        { id: 'CAFE_PUB', image: 'https://example.com/icon.png', pixelRatio: 1, offsetX: 0, offsetY: -10 },
    ],
};

places.updateConfig({ icon: iconConfig });
// or: pass as icon: { ... } to PlacesModule.create(map, { icon }) using the same shape
```

A place takes the entry for its own category, else the first entry with an `image` for the same
map category: `RESTAURANT` reaches a searched
`ITALIAN_RESTAURANT`, `CAFE` a `CAFE_PUB`. Same rule as `POIsModule`'s `icon.categoryIcons`
(above), so one list restyles both.

`offsetX`/`offsetY` (pixels, `CustomImage`) shift a custom icon from its coordinate. Scope:
only a `categoryIcons` entry that also has `image` — no `image` (existing sprite by `id`
alone) means the offset is a no-op. Not wired for
`PlaceIconConfig.default.image`, even though it also accepts `CustomImage`.

### Custom labels and extra feature properties

```ts
// Custom title function
places.updateConfig({ label: { title: (place) => place.properties.poi?.name ?? '' } });

// PlaceLabelConfig = LabelConfig (size, color, haloColor, haloWidth, opacity, font) + title, distance (ems from the icon).
// Unset fields keep the marker type's label: base-map follows the style's POI labels; pin and
// circle-icon draw '#333333' on a '#FFFFFF' halo (reversed on a dark map), size 14–16 and halo 1–1.5 px by zoom.
// Use this, not mapLibreMap.setPaintProperty on the places layers: setStyle and a markerType change
// rebuild those layers from the config, so the label config survives and a raw paint write is lost.
// `label` replaces the whole label: spread the current one to keep the title set above.
places.updateConfig({ label: { ...places.getConfig()?.label, opacity: 0.8, haloWidth: 2 } });

// Multi-line label using MapLibre format expression
import type { DataDrivenPropertyValueSpecification } from 'maplibre-gl';
const label: DataDrivenPropertyValueSpecification<string> = [
    'format',
    ['get', 'title'], { 'font-scale': 0.9 }, '\n', {},
    ['get', 'phone'], { 'font-scale': 0.8, 'text-color': '#3125d1' },
];
places.updateConfig({ label: { title: label } });

// Inject dynamic properties accessible in expressions via ['get', 'propName']
places.updateConfig({
    extraFeatureProps: {
        phone: (place) => `Tel: ${place.properties.poi?.phone}`,
        staticProp: 'Some static value',
    },
});
```

### Programmatic hover/click state (sync list ↔ map)

The same methods every data-owned module has (`user-events.md` → Event states). On Places they act
on the pins, clustered or not, and the pins and their entry points draw the states.

```ts
// Trigger hover state on a pin from outside the map (e.g. list mouseenter)
places.setEventState({ id: place.id, state: 'hover', mode: 'put' });

// Clear all event states (e.g. list mouseleave)
places.clearEventStates();

// Read them back: ids by state, absent when no place has it — includes states user clicks/hovers put
const [selectedID] = places.getEventStates().click ?? [];

// show() of new results drops all event states (even for the same ids) — put the selection back
await places.show(morePlaces);
if (selectedID) places.setEventState({ id: selectedID, state: 'click' });
```

`events.off('click')` removes every click handler; to remove one, call the function `events.on` returns.

### Connection lines between places

```ts
const places = await PlacesModule.create(map, {
    connections: {
        color: '#1F9D6B', // line; unset: color > accent > theme blue
        label: { title: (connection) => `${connection.minutes} min`, color: '#0B4F35', haloColor: '#FFFFFF' }, // no title, no label
        layers: { line: { paint: { 'line-width': 2 } } }, // MapLibre overrides: line, label
    },
});
await places.show([station, ...cafes.features]); // cafes: a discoverPlaces response
// Endpoints: a Place or a shown place's id; extra properties reach label.title. Replaces the previous lines
await places.showConnections(cafes.features.map((cafe) => ({ from: station.id, to: cafe.id, minutes: 4 })));
places.events.connections.on('click', (line) => console.log(line.properties));
await places.clearConnections(); // lines gone, places kept
```

- An id matching no shown place is skipped but stays in `getShown().connections`; ids resolve again on every
  redraw (config change, `setStyle`). `show()` and `clear()` drop every connection.

### Entry points (entrances) of places

Off unless `entryPoints` is set; then each shown place's `properties.entryPoints` (search, geocode,
reverse geocode) draws as a dot per entrance (larger for `type: 'main'`) plus a dotted line to the place.

```ts
const places = await PlacesModule.create(map, {
    entryPoints: {
        showFor: 'clicked', // 'all' | 'selected' (hover or click, default) | 'clicked'
        minZoom: 16,        // default 15
        layers: { line: { layout: { visibility: 'none' } } }, // MapLibre overrides: point, line
    },
});
// 'selected'/'clicked' need event states: register any handler (or use setEventState)
places.events.on('click', () => {});
places.updateConfig({ entryPoints: { showFor: 'all' } }); // keeps the rest; entryPoints: undefined stops them

// Payload: Feature<Point> at the entrance (dot or line hit alike), parent place by reference
places.events.entryPoints.on('click', (entryPoint) => {
    const { type, functions, entryPointIndex, placeID, place } = entryPoint.properties;
    // entryPoint is a valid route location: calculateRoute({ locations: [origin, entryPoint] })
});
```

- Hovering or clicking an entry point keeps its place's entry points drawn only if a handler covers
  them (`events` or `events.entryPoints`; `events.places` alone does not); under `selected` a
  `recently-hovered` pin counts too (see `user-events.md`).
- Dots draw over the pins, lines under them. `markerType: 'pin-clustered'` raises `minZoom` to `cluster.source.maxZoom` plus one, 18 by default.
- `reverseGeocode` geometry is the queried point: set `geometry.coordinates` to
  `properties.originalPosition` (the matched address) before `show`.

### Every knob as data — `placesKnobCatalogue`

Every plain-valued `PlacesModuleConfig` display setting, static and readable with no map: kind
(`toggle` / `number` / `color` / `enum` / `enums` / `offset`), `range` or `options`, and `default` where one value holds
everywhere. The id is the setting's path in the config; `placesKnobIds` lists them in catalogue order.

```ts
import { placesKnobCatalogue, type PlacesKnobValueOf } from '@tomtom-org/maps-sdk/map';

const badgeKnobs = placesKnobCatalogue.filter(({ id }) => id.startsWith('cluster.badge.'));
const knob = placesKnobCatalogue.find(({ id }) => id === 'entryPoints.showFor');
// { id: 'entryPoints.showFor', kind: 'enum', description: '…', options: ['all', 'selected', 'clicked'], default: 'selected' }
const size: PlacesKnobValueOf<'label.size'> = 14; // the plain value: an expression is not a knob value
```

| Id | Kind | Default |
|---|---|---|
| `markerType` | enum | `'pin'` |
| `color` | color | the accent |
| `visible` | toggle | `true` |
| `icon.default.style.fillColor` | color | `color` |
| `icon.default.style.outlineColor` | color | — |
| `icon.default.style.outlineOpacity` | number | — |
| `label.size` | number | 14–16 by zoom |
| `label.color` | color | by light/dark |
| `label.haloColor` | color | by light/dark |
| `label.haloWidth` | number | 1–1.5 by zoom |
| `label.opacity` | number | — |
| `label.distance` | number, ems from the icon | from the icon size |
| `label.font` | enums (`mapFonts`), first available wins | `Noto-Bold`, the style's under `base-map` |
| `label.typeface` | enum (`mapTypefaces`), `font` wins over it | — (the map's typeface) |
| `cluster.badge.color` | color | `'#000000'` |
| `cluster.badge.outlineColor` | color | `'#FFFFFF'` |
| `cluster.badge.outlineWidth` | number | `1.5` |
| `cluster.badge.label.color` | color | `'#FFFFFF'` |
| `cluster.badge.label.size` | number | `12` |
| `cluster.badge.radius.single` | number | `11` |
| `cluster.badge.radius.mixed` | number | `15` |
| `cluster.badge.offset` | offset, pixels, −32 to 32 per axis | `[12, -14]` |
| `cluster.source.radius` | number | `60` |
| `cluster.source.maxZoom` | number | `17` |
| `cluster.source.minPoints` | number | MapLibre's, 2 |
| `entryPoints.showFor` | enum | `'selected'` |
| `entryPoints.minZoom` | number | `15` |
| `connections.color` | color | the module's `color`, else the accent, else `#3f9cd9` (`#5AB6F0` dark) |
| `connections.label.color` | color | a shade of the line's, else `#1a5f8a` (`#A9D6F5` dark) |
| `connections.label.haloColor` | color | `#FFFFFF` (`#333333` dark) |

- Not in it: the place and connection labels' `title`, the cluster source's `properties`,
  the `icon` images and `mapping`, `layers`, `beforeLayerConfig`,
  `extraFeatureProps` and `events` — callbacks, images, structured or MapLibre values.
- `entryPoints.*` draws nothing until `entryPoints` is set; `cluster.*` applies under `pin-clustered` only. A `—` or prose default is not in the entry.
- `setKnob(places, placesKnobCatalogue, 'cluster.badge.color', '#3f9cd9')`, `getKnob` and `resetKnob`
  work by id. Entry shape, kinds and the knob functions: `map-setup.md` § Every setting as data.

### BYOD — display your own GeoJSON as places

```ts
import type { Places } from '@tomtom-org/maps-sdk/core';

const data: Places = await fetch('https://your-api.com/data.json').then(r => r.json());

const places = await PlacesModule.create(map, {
    markerType: 'base-map',
    icon: { mapping: { to: 'poiCategory', fn: () => 'COMPANY' } }, // map all to one icon
    label: { title: (place) => place.properties['Name'] },
    layers: { main: { minzoom: 15 } },
});

await places.show(data);
```

- Draw your own points through `show()`, never by feeding `preparePlacesForDisplay` output to a layer
  of your own: the module adds the images its `iconID`s name, and owns events, clustering and
  restoration after `setStyle`.
- `icon.mapping` to `poiCategory` also sets `category`/`group`, so under `base-map` your points take
  the style's icon and label colour for that category.
- No `poi.name` and no `address.freeformAddress` → give `label.title` a function; the default label
  reads one of them.

### Result card / popup on a clicked place — yours to build

`PlacesModule` supplies the events and the hit-testing, **not** a result card, popup or info window
— don't look for one. A card is application chrome (content, layout, closing are the app's); a
place is a point the click hands you, so a MapLibre `Popup` or your own DOM panel anchors on it.
`RoutingModule` draws summary bubbles only because a route has no single point to anchor one to.

```ts
import { Popup } from 'maplibre-gl';

const popup = new Popup({ closeButton: false, offset: 35 });
places.events.places.on('click', async (place) => {
    popup
        .setLngLat(place.geometry.coordinates as [number, number])
        .setText(place.properties.poi?.name ?? place.properties.address.freeformAddress)
        .addTo(map.mapLibreMap);
    // Fuller details (opening hours…) for a side panel
    const details = await getPlaceDetails({ entityId: place.id, openingHours: 'nextSevenDays' });
    if (details) showDetailsPanel(details);
});

// show() / clear() don't know about your popup — close it yourself, or it floats over a gone pin
popup.remove();
await places.show(newResults);
```

---

## Search — additional options

```ts
// Brand-based search
const brand = await discoverPlaces({ filters: { poiBrands: ['Starbucks'] }, geoBias: { position: [4.9, 52.4] } });

// Typeahead (partial query)
const partial = await discoverPlaces({ query: 'amst', typeahead: true, geoBias: { position: [4.9, 52.4] } });

// Administrative geographies (e.g. municipalities, whose outlines geometryData fetches)
const municipalities = await discoverPlaces({
    filters: { countries: ['ESP'], geographyTypes: ['Municipality'] },
    limit: 16,
});
```

---

## Pagination — opaque cursor

```ts
let response = await discoverPlaces({ query: 'cafe', limit: 20 });
const all = [...response.features];

while (response.properties?.nextCursor) {
    response = await discoverPlaces({ query: 'cafe', limit: 20, cursor: response.properties?.nextCursor });
    all.push(...response.features);
}

// "Load more": one page per click — keep the request and the last cursor
const request: FuzzySearchParams = { query: 'cafe', geoBias: { position: [4.9, 52.4] }, limit: 20 };
let nextCursor: string | undefined;

const loadPage = async (cursor?: string) => {
    loadMoreButton.disabled = true; // a second click before the page lands would fetch it twice
    const page = await discoverPlaces({ ...request, cursor });
    appendToResultList(page.features);
    nextCursor = page.properties?.nextCursor;
    loadMoreButton.disabled = !nextCursor;
};
await loadPage();
loadMoreButton.onclick = () => loadPage(nextCursor);
```

- Pass `nextCursor` back unchanged as `cursor`, with the same parameters. Never build or parse one;
  a value the SDK did not mint throws `SDKError`. A new query or different `filters` is a new search: no `cursor`.
- `nextCursor` is absent at the end, after an empty page, and once the next page would start past result 1900.
  Drive "has more" off `nextCursor`, not `totalResults`.
- Fuzzy search (no `geometries`, no `route`) and `geocode` page this way; geometry and along-route
  responses carry no cursor.

---

## Search suggestions — places, brands and categories for a search box

Use this for a search box. `getSearchSuggestions()` calls search and autocomplete in parallel and merges them
into one ranked list, so `'italian'` returns the cuisine *category* and *Ristorante Italiano down
the road* together. Not typeahead-only: a complete query works as well as a partial one.

```ts
// Per keystroke, take `signal` from `createLatestRequest().run` (services-config.md), so a newer
// query retires the pair still in flight
const { suggestions } = await getSearchSuggestions({
    query: 'italian',
    limit: 5,                     // default 5, capped at 10
    geoBias: { position: [4.9, 52.4] }, // a point only; biases both arms, distances are measured from here
    filters: { countries: ['NLD'] },
    signal,                       // one signal for both calls
});

for (const result of suggestions) {
    if (result.kind === 'brand' || result.kind === 'category') {
        // A refinement, not a location: no geometry. Run the follow-up it describes.
        const narrowed = await result.refine();            // === discoverPlaces(result.refineParams)
        const adjusted = await discoverPlaces({ ...result.refineParams, limit: 50 });
    } else {
        const place = await result.resolve();               // the full Place, on pick
        map.mapLibreMap.flyTo({ center: place.geometry.coordinates as [number, number] });
    }
}
```

`kind` is `'place' | 'address' | 'street' | 'area'` (a location: `id`, `title`, `subtitles`,
`distanceInMeters`, and `resolve(signal?)` for the full `Place`) or `'brand' | 'category'` (a refinement:
`refine(signal?)` and `refineParams`, no position; a category suggestion also carries its `category` code).
Narrow on `kind`; there is no geometry until `resolve()`.
`title` is a POI's name or an address's first line; `subtitles` are the remaining address lines, ending
with the country only when it isn't the one the search is in (`['Rue du Moulin 26', '7800 Ath', 'Belgium']`).

`filters`: `kinds` (result kinds; also decides which arms run), `countries` (both arms), `poiTypes`, `areaTypes`,
`boundingBox` (search arm only; with `geoBias` too, the box restricts and `geoBias.position` only measures distance; `refine()` keeps the box).

The blend follows Places Search v3: at most one brand or category, first, and only when the whole
query names it from a word start (`pizz` → Pizzeria; `baker st`, `amster` → none). A brand also needs
a leading place carrying it. Places follow in search order. Asking only for `brand`/`category` via
`filters.kinds` returns every recognised refinement instead. The blend is the SDK's heuristic.

Brand and category suggestions alone — no places — are one request:

```ts
const { suggestions } = await getSearchSuggestions({ query: 'star', filters: { kinds: ['brand', 'category'] } });

for (const refinement of suggestions) {
    if (refinement.kind === 'brand' || refinement.kind === 'category') {
        const places = await discoverPlaces({ ...refinement.refineParams, geoBias: { boundingBox: map.getBBox() } });
    }
}
```

---

## Fields that may be absent

Not guaranteed — the type is the contract, so guard an optional property rather than assuming a
value.

| Field | What it carries |
| --- | --- |
| `places.properties.totalResults` | Total matches beyond the page returned |
| `places.properties.fuzzyLevel` | How loosely the query was matched |
| `places.properties.geoBias` | The position results were biased towards |
| `places.properties.queryIntent` (fuzzy search) | Coordinates, what3words and "near X" detection |
| `place.properties.score` | Relevance score, for thresholding and merging |
| `places.bbox` | Bounding box, on results covering an area |

```ts
if (results.properties) {
    const { numResults, totalResults, nextCursor } = results.properties;
    const label = totalResults === undefined ? `${numResults} results` : `${numResults} of ${totalResults}`;
    const hasMore = nextCursor !== undefined; // not totalResults arithmetic
}
```

`fuzzyLevel` absent means "not reported", **not** `0`/exact match.

---

## Gotchas

- Pass `query` as plain text to `geocode`, `discoverPlaces`, `getSearchSuggestions`, along-route search and geometry search. The SDK encodes it. A value you already passed through `encodeURIComponent` is encoded again and can resolve to a different place (`Los Angeles` becomes a street in Gijón).
- `boundingBox`: `[west, south, east, north]`
- `place.properties.poi?.categories` — `POICategory[]` (standardized enum, e.g. `'ITALIAN_RESTAURANT'`)
- `place.properties.poi?.localizedCategories` — `string[]` (human-readable, e.g. `'restaurant'`)
- An `extraFeatureProps` entry is a JSON value or a `(place) => jsonValue` callback, read in `layers`
  expressions via `['get', 'propName']`. To have these,
  `label.title` and `icon.mapping.fn` typed for a narrower place shape, name it on the config —
  `PlacesModuleConfig<SearchPlaceProps>`, `PlacesModule.create<Store>(map, …)`
  or `updateConfig<Store>(…)` — with `type Store = CommonPlaceProps & { storeName: string }`
- Runtime changes to `label`, `icon`, `markerType` and `extraFeatureProps` go through `updateConfig` after `await PlacesModule.create(map)`; `PlacesModule` has no `get()`. A nested object passed replaces the current one (`map-setup.md` § Changing a setting)
- `getSearchSuggestions()` costs **two requests** per call unless `filters.kinds` keeps to one side
  (refinement kinds only, or location kinds only), and does no debouncing or caching — that belongs
  in your input loop. A failure on either arm rejects the whole call, as service `SearchSuggestions`
- Guard the optional fields rather than assuming them: `place.properties.score`, `places.bbox`,
  and `places.properties.totalResults` / `.fuzzyLevel` / `.geoBias` / `.queryIntent`
- **`show()` replaces, never merges**, and drops the event states (selection) of what it replaces
  — even a place shown again under the same id — plus every connection. Search → select →
  search again: keep the selected id yourself and `setEventState({ id, state: 'click' })` after
  the new `show()`. Re-showing `getShown().places` keeps states (they ride on `properties.eventState`)
- Event states and connections survive `setStyle`, `applyConfig`, `updateConfig` and `setKnob`; `clear()`
  and `setStyle(style, { resetState: true })` drop them
