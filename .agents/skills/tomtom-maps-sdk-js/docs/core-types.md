# Core Types Reference

## Imports

```ts
import type {
    Place, Places, CommonPlaceProps, SearchPlaceProps, RevGeoAddressProps,
    Route, Routes, RouteSummary, SectionsProps,
    TrafficIncident, TrafficIncidentDetails, TrafficIncidentCategory,
    TrafficIncidentProperties, DelayMagnitude, TrafficIncidentTimeValidity,
    TrafficIncidentRequestCategory,
} from '@tomtom-org/maps-sdk/core';
// Category lists are runtime values, so they need a value import, not `import type`.
import { fullTrafficIncidentCategories, trafficIncidentRequestCategories } from '@tomtom-org/maps-sdk/core';
```

---

## Place object

Search, geocoding, reverse geocoding and place details return `Place = Feature<Point>` or `Places = FeatureCollection<Point>`, each service with its own properties type. See [Places](https://docs.tomtom.com/maps-sdk-js/guides/core/places.md).

```ts
const place: Place = await geocodeOne('Amsterdam');

// Geometry
place.geometry.coordinates;          // [longitude, latitude]

// Presence/type
place.properties.type;               // 'POI' | 'Street' | 'Geography' | 'Point Address' | 'Address Range' | 'Cross Street'

// Address
place.properties.address.freeformAddress;    // 'Dam Square 1, 1012 JS Amsterdam, Netherlands'
place.properties.address.streetNumber;       // '1'
place.properties.address.streetName;         // 'Dam Square'
place.properties.address.municipality;       // 'Amsterdam'
place.properties.address.countryCode;        // 'NL'
place.properties.address.countryCodeISO3;    // 'NLD'
place.properties.address.postalCode;         // '1012 JS'
place.properties.address.countrySubdivision; // 'North Holland'
// also: localName, neighborhood, municipalitySubdivision, municipalitySecondarySubdivision,
// countrySecondarySubdivision, countrySubdivisionCodeIso, postalName, routeNumbers
```

`place.properties.geographyType` lists the administrative levels of a `'Geography'` place, most specific first (`'Country'`, `'Municipality'`, …; `geographyTypes` holds them all).

### POI properties (when `type === 'POI'`)

```ts
const poi = place.properties.poi;        // undefined if not a POI

poi?.name;                               // 'Starbucks'
poi?.phone;                              // '+31 20 123 4567'
poi?.url;                                // 'https://starbucks.com'
poi?.brands;                             // ['Starbucks']
poi?.categories;                         // POICategory[] — e.g. ['COFFEE_SHOP'] (standardized enum)
poi?.localizedCategories;               // string[] — e.g. ['coffee shop'] (human-readable)
poi?.openingHours?.alwaysOpenThisPeriod; // boolean
poi?.openingHours?.timeRanges;          // [{ start: { date, hour, minute }, end: {...} }]
poi?.timeZone?.ianaId;                   // 'Europe/Amsterdam'
```

### Data source IDs (for follow-up calls)

```ts
place.properties.dataSources?.geometry?.id;   // pass to geometryData()
place.properties.dataSources?.poiDetails?.id; // pass to getPlaceDetails()
```

A reverse geocoded place has no `geometry` data source. To draw its boundary, search it by name
with its `geographyType` (`discoverOnePlace`) and pass that result to `geometryData()`.

### Search-specific properties

```ts
// On discoverPlaces() and geocode() results (SearchPlaceProps / GeocodingProps)
(place as Place & { properties: SearchPlaceProps }).properties.score;    // relevance score
(place as Place & { properties: SearchPlaceProps }).properties.distance; // meters from bias position
```

Geocoding results add `matchConfidence.score` (how well the text matched) and are never `'POI'`.

### Reverse geocode-specific properties

```ts
(place.properties as RevGeoAddressProps).originalPosition;  // [lng, lat] the service matched
// note: place.geometry holds the [lng, lat] you queried
```

### Entry points

```ts
place.properties.entryPoints?.forEach(ep => {
    ep.type;        // 'main' | 'minor' — absent on reverse geocoded places
    ep.position;    // [longitude, latitude]
    ep.functions;   // ['FrontDoor', 'ParkingGarage', ...]
});
```

Reverse geocoding fills `entryPoints` too, from the points the service places on the road network,
so `getPosition(place, { useEntryPoint: 'main-when-available' })` and routing's `useEntryPoints`
work the same on a reverse geocoded address as on a search result.

### Related POIs (parent / child relationships)

```ts
place.properties.relatedPois?.forEach(rel => {
    rel.relationType;  // 'parent' | 'child'
    rel.id;            // use with getPlaceDetails()
});
```

---

## Route object

`calculateRoute()` returns `Routes = FeatureCollection<LineString>`. See [Routes](https://docs.tomtom.com/maps-sdk-js/guides/core/routes.md).

```ts
const routes: Routes = await calculateRoute({ locations: [origin, destination] });
const route: Route = routes.features[0];

// On the feature, not in properties
route.id;                             // unique per route
route.bbox;                           // BBox of the path

// Path
route.geometry.coordinates;           // [lng, lat][] — all path points

// Cumulative distance/time at sampled path points; absent with `extendedRouteRepresentations: []`
route.properties.progress;            // read via the route progress utilities (core-utilities.md)

// Index (0 = main route, 1+ = alternatives)
route.properties.index;               // 0
```

### Summary

```ts
const s: RouteSummary = route.properties.summary;

s.lengthInMeters;                      // total distance
s.travelTimeInSeconds;                 // total duration
s.trafficDelayInSeconds;               // extra time due to traffic
s.trafficLengthInMeters;               // traffic-affected distance
s.arrivalTime;                         // Date object
s.departureTime;                       // Date object
s.noTrafficTravelTimeInSeconds;        // free-flow time
s.historicTrafficTravelTimeInSeconds;  // historical average
s.liveTrafficIncidentsTravelTimeInSeconds; // with live incidents only

// Alternatives only: where it forks off the main route, and the distance and time from the start to it
s.deviationPoint;                      // Position
s.deviationDistanceInMeters;
s.deviationTimeInSeconds;
```

### Sections

```ts
const sections: SectionsProps = route.properties.sections;

sections.leg;                // LegSectionProps[] — per waypoint segment
sections.traffic;            // TrafficSectionProps[] — incident-affected stretches
sections.country;            // CountrySectionProps[] — cross-border transitions
sections.toll;               // SectionProps[] — stretches charging a per-use toll
sections.tollRoad;           // SectionProps[] — stretches that cost money by ANY scheme
sections.tollVignette;       // CountrySectionProps[] — one per country needing a vignette
sections.motorway;           // SectionProps[]
sections.ferry;              // SectionProps[]
sections.tunnel;             // SectionProps[]
sections.pedestrian;         // SectionProps[]
sections.urban;              // SectionProps[]
sections.unpaved;            // SectionProps[]
sections.lanes;              // LaneSectionProps[] — only with guidance; with a sectionTypes list, only if it names lanes
sections.speedLimit;         // SpeedLimitSectionProps[]
sections.roadShields;        // RoadShieldSectionProps[]
sections.importantRoadStretch; // ImportantRoadStretchProps[]
sections.carpool;            // SectionProps[]; also carTrain, lowEmissionZone, vehicleRestricted

// Sections have startPointIndex, endPointIndex (indices into route.geometry.coordinates);
// optional on leg sections, present when the route has its path geometry
const section = sections.motorway?.[0];
if (section) route.geometry.coordinates.slice(section.startPointIndex, section.endPointIndex + 1);

// Country sections tile a route end to end, and carry both code forms.
const countries = sections.country ?? [];
countries[0]?.countryCodeISO2;   // 'NL'
countries[0]?.countryCodeISO3;   // 'NLD'
```

**`toll` vs `tollRoad`.** `toll` answers *will this cost a toll to drive*; `tollRoad` answers *does
this cost anything at all to drive* — a vignette-only motorway or a city charge zone appears in
`tollRoad` and not in `toll`. `tollRoad` is a superset of `toll`, and it is what `RoutingModule`'s
toll overlay draws.

### Leg sections

```ts
sections.leg?.forEach(leg => {
    leg.summary;                // LegSummary: this leg alone, plus stopTimeInSeconds
    leg.originalWaypointIndex;  // which entry of the request's `locations` this leg arrives at
});
```

`legs[i]` is **not** reliably the leg arriving at `locations[i + 1]`: a path location expands into
legs of its own. Use `originalWaypointIndex` to map a leg back to a stop the caller asked for. It is
`undefined` on the final leg and on a leg ending somewhere the caller did not ask for, so handle
that rather than assuming a number.

### Traffic sections

```ts
sections.traffic?.forEach(t => {
    t.categories;          // TrafficIncidentCategory[] — same type as incident.properties.category; from TEC cause codes, else the icon category
    t.magnitudeOfDelay;    // DelayMagnitude
    t.delayInSeconds;      // number
    t.effectiveSpeedInKmh; // number
    t.eventId;             // string — join key back to the traffic incident details service
});
```

### Guidance

```ts
route.properties.guidance?.instructions.forEach(inst => {
    inst.message;         // 'Turn right onto Dam Square' — generated and localised by the service
    inst.maneuver;        // Maneuver code, e.g. 'TURN_RIGHT'
    inst.maneuverPoint;   // Position — [lng, lat]
    inst.pathPointIndex;  // index into route.geometry.coordinates
    inst.routeOffsetInMeters; // distance from the route start
    inst.roundaboutType;  // 'REGULAR' | 'SMALL' — on roundabout maneuvers
    inst.maneuverView;    // { onRouteAngle?: ManeuverAngle, offRouteAngles: ManeuverAngle[] }
    inst.sideRoads;       // SideRoad[] — { side, offsetFromManeuverInMeters, isDrivable? }
});
```

- `message` is typed optional but present on every instruction when guidance was requested, in the
  request's language — a turn list needs no translation table of your own.
- `ManeuverAngle` is a relative direction, not degrees: `'STRAIGHT' | 'SLIGHT_RIGHT' | 'RIGHT' |
  'SHARP_RIGHT' | 'SLIGHT_LEFT' | 'LEFT' | 'SHARP_LEFT' | 'BACK'`. `maneuverView` describes the
  junction layout — the direction the route takes, plus the directions it does not.
- `SideRoadSide` is `'LEFT' | 'RIGHT' | 'LEFT_AND_RIGHT'`; `isDrivable` says whether the side road
  can actually be driven into.
- Name fields (street, road number, signpost exit, intersection, tollgate, country) are
  `InstructionText`: read the name from `.text`, e.g. `inst.nextRoadInfo.streetName?.text`.
- `inst.previousRoadInfo` / `inst.nextRoadInfo` are `RoadInformation`, whose `countryCode` is ISO3,
  matching the rest of the SDK.

---

## Traffic types

### `TrafficIncidentCategory`

```ts
import type { TrafficIncidentCategory, TrafficIncidentRequestCategory } from '@tomtom-org/maps-sdk/core';
import { fullTrafficIncidentCategories, trafficIncidentRequestCategories } from '@tomtom-org/maps-sdk/core';

// TrafficIncidentCategory — the 15 categories an incident can be *received* with:
// 'accident' | 'animals-on-road' | 'broken-down-vehicle' | 'danger' |
// 'flooding' | 'fog' | 'frost' | 'jam' | 'lane-closed' | 'narrow-lanes' |
// 'other' | 'rain' | 'road-closed' | 'roadworks' | 'wind'

fullTrafficIncidentCategories;    // all 15, as a readonly array — use for a legend or a display filter
trafficIncidentRequestCategories; // the 13 accepted as a request filter — use for a search UI
```

**Two lists, and they are not interchangeable.** `TrafficIncidentCategory` /
`fullTrafficIncidentCategories` is what you can *receive*.
`TrafficIncidentRequestCategory` / `trafficIncidentRequestCategories` is the strict subset you
can *send* as `trafficIncidentDetails({ categoryFilter })` — it excludes `'animals-on-road'` and
`'narrow-lanes'`, which arrive on vector-tile features only; the Incident Details API has no such
categories and rejects the filter. Build request filters from the request list only.

### `TrafficIncidentTimeValidity`

`'present' | 'future'`, listed by `trafficIncidentTimeValidities` (`present` first): what
`trafficIncidentDetails({ timeValidityFilter })` and `TrafficIncidentsModule`'s `timeValidity` take,
and what each incident's `timeValidity` property says.

### `DelayMagnitude`

`'unknown' | 'minor' | 'moderate' | 'major' | 'indefinite'`

- `indefinite` = road closure / unknown duration

### `TrafficIncident` and `TrafficIncidentDetails`

```ts
// Return type of trafficIncidentDetails()
const result: TrafficIncidentDetails = await trafficIncidentDetails({ bbox: place });

result.features.forEach((incident: TrafficIncident) => {
    incident.geometry.type;              // 'Point' | 'LineString'
    incident.geometry.coordinates;       // [lng, lat] or [[lng, lat], ...]

    const p: TrafficIncidentProperties = incident.properties;
    p.id;
    p.category;           // TrafficIncidentCategory
    p.magnitudeOfDelay;   // DelayMagnitude
    p.events;             // [{ description, code }]
    p.from;               // road name (start of affected stretch)
    p.to;                 // road name (end of affected stretch)
    p.lengthInMeters;
    p.delayInSeconds;
    p.roadNumbers;        // ['A10']
    p.timeValidity;       // 'present' | 'future'
    p.startTime;          // Date | undefined
    p.endTime;            // Date | undefined
    p.probabilityOfOccurrence; // 'certain' | 'probable' | 'risk_of' | 'improbable'
});
```

---

## Gotchas

- `place.properties.poi?.categories` is `POICategory[]` (e.g. `'ITALIAN_RESTAURANT'`) — NOT raw strings
- `place.properties.poi?.localizedCategories` is `string[]` (e.g. `'restaurant'`) — human-readable
- `CommonPlaceProps` has NO `score` field — that is on `SearchPlaceProps` (search and geocoding results)
- `RouteSummary.arrivalTime` / `departureTime` are `Date` objects — not ISO strings
- `SectionsProps` has no index signature — access properties by name, not dynamic key
- `DelayMagnitude` is a string union — not a number
- Traffic incident geometry can be either `Point` (local) or `LineString` (road stretch)
