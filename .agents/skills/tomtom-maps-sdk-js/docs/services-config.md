# Services Configuration Reference

## Imports

```ts
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import {
    createLatestRequest,
    type LatestRequestOptions,
    SDKAbortError,
    SDKError,
    SDKServiceError,
} from '@tomtom-org/maps-sdk/services';
import { type SDKErrorCode, sdkErrorCodes } from '@tomtom-org/maps-sdk/core';
```

---

## Global configuration

Set once at startup — all service calls and maps inherit these settings:

```ts
TomTomConfig.instance.put({
    apiKey: 'YOUR_API_KEY',
    language: 'en-GB',
});

// Update at runtime — keys you leave out keep their value; a nested object you pass (displayUnits, retry) replaces the current one whole
TomTomConfig.instance.put({ language: 'fr-FR' });

// Read current config
const { language } = TomTomConfig.instance.get();

// Reset to defaults (apiKey becomes '')
TomTomConfig.instance.reset();
```

| Key | Default | Notes |
|---|---|---|
| `apiKey` | `''` | |
| `commonBaseURL` | `'https://api.tomtom.com'` | Only for routing every request (services, style, tiles, sprites, glyphs) through your own proxy. Leave `apiKey` unset too for proxy-credentials mode: no key sent, `credentials: 'include'`. Must be absolute and `https:`; `http:` only for loopback (`localhost`, `127.x`, `[::1]`), else `INSECURE_BASE_URL`, even with `validateRequest: false`. See [Proxying your API calls](https://docs.tomtom.com/maps-sdk-js/guides/security/proxying-api-calls.md). |
| `language` | unset → APIs answer in `NGT` (local language) | `Language` type; `languages` lists them. `Language` lists every language the map labels carry. A service that lacks one answers in local names: search, geocoding and reverse geocoding do for `hi-IN` and `ja-JP`, and route instructions, POI category names and incident descriptions come in the nearest language the API has, else English. The SDK sends each API a code it takes (`zh-Hans` goes out as `zh-CN`, `zh-Hant` as `zh-TW`) and leaves the language off where the API has none close to it, so never map codes yourself |
| `geopoliticalView` | unset → caller's country default | [below](#geopolitical-view) |
| `sendUserAgentHeader` | unset → sent, as `true` | `false` stops every service and map request from carrying the `tomtom-user-agent` header (`MapsSDKJS/<version>`; `MapsSDKJS-AgentToolkit/<plugin version>` on what the Agent Toolkit plugin requests). A map reads it at construction |
| `displayUnits` | unset → metric, `km`/`m`, `hr`/`min` | `{ distance: { type: 'metric' \| 'imperial_us' \| 'imperial_uk', …labels }, time: { hours, minutes } }` — used by `formatDistance` / `formatDuration` and the routing module's labels; see `core-utilities.md` |
| `retry` | `{ initialWaitMs: 447, backoffFactor: 1.618, timeoutMs: 40000 }` | Retries `429` with exponential backoff, each wait drawn between half and all of it; a `Retry-After` header is waited out exactly. Service calls only: MapLibre doesn't retry map tiles, sprites or glyphs, and the map reports a failed one to `addErrorHandler` (see `map-setup.md`) |

- A field left out of a `put`'s `retry` takes its default (not an earlier `put`'s value); `retry: undefined` disables retrying.
- `get()` returns `apiKey`, `commonBaseURL`, `retry` (unless you set it to `undefined`) and the keys you `put`. A key you never set reads `undefined` and behaves as its default in the table.
- A service call's own `retry` overrides the global one field by field (`retry: { timeoutMs: 2000 }` keeps the global wait and factor); `retry: undefined` on a call disables retrying for that call only.
- Service calls do not take `displayUnits` (a compile error): pass it to `formatDistance` / `formatDuration` or the `RoutingModule` config instead.
- A `TomTomMap` takes the same keys in its constructor params, overriding the global values for that map.
- Node.js: 22 or newer, the package's `engines` floor. The package is ESM only — `import`, not `require`. Read the key from `process.env`.

### Geopolitical view

`geopoliticalView` picks whose perspective disputed territories are shown from: the borders and names the map draws, and the country search and geocoding results report. Set globally, it reaches the map and every search, place details, geocoding and reverse geocoding call; a map's or a call's own `geopoliticalView` overrides it.

```ts
TomTomConfig.instance.put({ geopoliticalView: 'IN' });            // map + services
map.setGeopoliticalView('IN');                                     // an existing map only; reloads its tiles in place
await reverseGeocode({ position, geopoliticalView: 'Unified' });   // one call only
```

- `geopoliticalViews` (core) lists all 20 values of the `GeopoliticalView` type: `Unified` (international), `AE` (Arabic: Gulf states), and the country codes `AR`, `BN`, `CL`, `CN`, `DZ`, `IL`, `IN`, `KR`, `MA`, `MY`, `PH`, `PK`, `RS`, `RU`, `TR`, `TW`, `US`, `VN`.
- Unset, each API uses the default view for the caller's country; callers in India only ever get `IN`.
- A view an API does not serve is left out of its requests, so the call still succeeds in that default: map tiles skip `CN`, `RU`; search, place details and reverse geocoding skip `KR`, `US`; geocoding also skips `AE`, `BN`, `CL`, `DZ`, `MY`, `PH`, `VN`.
- `servesGeopoliticalView(view, api)` (core) tells whether the SDK sends `view` to that API, so you can label a result with the view its request carried. `api` is a `GeopoliticalViewAPI`: `'mapTiles'`, `'search'`, `'placeDetails'`, `'reverseGeocoding'` or `'geocoding'`. The map and the services read the same predicate, so never copy the table above into app code. It answers what was sent, not what the API applied: callers in India get `IN` either way.
- `map.setGeopoliticalView(undefined)` returns the map to the caller's default view. It changes the map only: to keep map and services in agreement at runtime, call both `TomTomConfig.instance.put({ geopoliticalView })` and `map.setGeopoliticalView(geopoliticalView)`.

See [Geopolitical views](https://docs.tomtom.com/maps-sdk-js/guides/core/geopolitical-views.md).

---

## Per-call options

Every service call merges the global config under its own params, so a per-call `apiKey`, `language`, `geopoliticalView`, `commonBaseURL` or `retry` (field by field) wins for that call only. Endpoint paths and API versions are not configurable.

```ts
// Override API key for a specific call
const results = await discoverPlaces({
    query: 'restaurants',
    apiKey: process.env.TOMTOM_PREMIUM_API_KEY,
});

// Disable request validation (saves CPU when inputs are trusted)
await discoverPlaces({
    query: 'coffee',
    validateRequest: false,
});

// Cancel a call; to drop a superseded one, use `createLatestRequest` (below)
const controller = new AbortController();
await discoverPlaces({
    query: 'coffee',
    signal: controller.signal,
});

// There is no `timeout` option — compose a deadline onto the signal instead
await calculateRoute({
    locations: [[4.9, 52.4], [2.3, 48.8]],
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
});
```

Call order: an already-aborted signal rejects first (nothing is sent) → global merge → `commonBaseURL` check (`INSECURE_BASE_URL`, even with `validateRequest: false`) → validation → build request → send (with `429` retries) → parse.

- Aborting cancels the in-flight HTTP request, including a pending `429` retry wait.
- A deadline rejects with `SDKAbortError` too; `error.cause` (the signal's reason, a `TimeoutError` for `AbortSignal.timeout`) tells it apart from a manual abort.
- Where `discoverPlaces` / `discoverOnePlace` / `geocode` / `geocodeOne` take the signal — see `places.md` § Search → display on map. `calculateReachableRanges` takes it as a second argument — see `routing.md`.

Validation rejects a parameter the service doesn't know, and names it (`INVALID_REQUEST`, an `unrecognized_keys` issue):

- Only the params you pass are checked, not the merged global config. A key set to `undefined` counts as absent.
- A key the service takes one level down gets a pointer, as for the search filters that live under `filters`: `poiCategories is not a parameter of AlongRouteSearch. Did you mean filters.poiCategories?`
- An along-route `discoverPlaces` (with `route`) also needs a `query` or at least one filter other than `indexes`.
- `validateRequest: false` skips both checks; an unknown key is then dropped silently.

### Keeping only the latest request

When a new user action supersedes the previous call (a click lookup, search-as-you-type, refetch on
map move), use `createLatestRequest` instead of swapping an `AbortController` by hand:

```ts
import { createLatestRequest, reverseGeocode } from '@tomtom-org/maps-sdk/services';

const latestLookup = createLatestRequest();

map.mapLibreMap.on('click', async (event) => {
    const lookup = await latestLookup.run((signal) =>
        reverseGeocode({ position: event.lngLat.toArray(), signal }),
    );
    if (!lookup.current) return; // retired by a newer run or by cancel()
    showAddress(lookup.value);
});
clearButton.addEventListener('click', latestLookup.cancel);
```

- `run(request)` aborts the previous request (by default, see `supersede` below), then calls
  `request(signal)` synchronously. Pass that `signal` to every service call inside it; several chained
  calls may share it.
- Resolves `{ current: true, value }` or `{ current: false }`. A retired request never rejects, and
  an answer landing after `cancel()` is dropped, so no `SDKAbortError` handling or post-`await`
  `signal.aborted` check is needed.
- Errors of the current request are rethrown, including a deadline you composed onto the signal.
- `isRunning()` reports whether a request is in flight. Use one `createLatestRequest()` per thing
  that can be superseded independently.
- It cancels, it does not debounce: every `run` still sends its request. To send fewer while the
  user types or drags, debounce the input yourself and call `run` from the debounced handler.

**Requests that start faster than they answer** (a route re-planned during a drag): with the default
`supersede: 'on-start'` each run aborts the last, so nothing shows until the stream pauses. Pass
`supersede: 'on-answer'` (`LatestRequestOptions`, type `LatestRequestSupersede`) to show each answer as it lands:

```ts
import { calculateRoute, createLatestRequest } from '@tomtom-org/maps-sdk/services';

const latestRoute = createLatestRequest({ supersede: 'on-answer' });
const result = await latestRoute.run((signal) => calculateRoute({ locations, signal }));
if (result.current) await routing.showRoutes(result.value);
```

- The older runs keep going; a newer answer (or error) aborts those still in flight, and an older
  answer landing after a newer one resolves `{ current: false }`, so the route never steps back.
- `cancel()` aborts every run in flight; `isRunning()` is true while any is.
- The route-dragging plugin (`route-dragging.md`) re-plans this way during a drag.

---

## Error handling

Every rejection is an `SDKError` with `.code` (`SDKErrorCode`, core — branch on it, never on
`.message`; the TomTom Navigation SDK's names for the same failures), `.canRetry` (`true` for `RATE_LIMITED`,
`LIVE_SERVICE_NOT_AVAILABLE`, `NETWORK_NOT_AVAILABLE`: retry later; any other code fails the same way again),
`.service` naming the service (`ServiceName`, a literal union: `'Geocode'`, `'FuzzySearch'`, `'GeometrySearch'`, `'AlongRouteSearch'`,
`'DiscoverPlaces'`, `'Autocomplete'`, `'SearchSuggestions'`, `'PlaceDetails'`, `'POICategories'`, `'ReverseGeocode'`,
`'GeometryData'`, `'Routing'`, `'ReachableRange'`, `'TrafficIncidentDetails'`, `'TrafficAreaAnalytics'`) and `.sdkVersion`. That includes a request the service cannot build at all, such as a geometry type geometry search does not take, sent with `validateRequest: false`: an `INVALID_REQUEST`.

Two subclasses carry more:

| `code` | When |
|---|---|
| `INVALID_REQUEST` | SDK validation failed (`.issues` = Zod issues), a request sent with `validateRequest: false` could not be built, or API `400` / other `4xx` |
| `INSECURE_BASE_URL` | `commonBaseURL` is neither `https:` nor `http:` on loopback (`localhost`, `127.x`, `[::1]`) |
| `INVALID_CREDENTIALS` | API `401`: key missing, invalid or expired |
| `INSUFFICIENT_PERMISSIONS` | API `403`: key valid but not allowed this request — `.apiErrorCode` `'Forbidden'` = API not enabled for the key (or a Private Preview API it lacks access to), `'InvalidReferer'` = the key's domain restriction refused the page |
| `NOT_FOUND` | API `404`, or `geocodeOne` (`.service` `'Geocode'`) / `discoverOnePlace` (`'FuzzySearch'`) found no place |
| `RATE_LIMITED` | API `429`, after the `retry` budget is spent |
| `LIVE_SERVICE_NOT_AVAILABLE` | API `5xx` |
| `NETWORK_NOT_AVAILABLE` | no response (offline, DNS, TLS, CORS); `.cause` = what `fetch` threw |
| `ABORTED` | signal aborted — an `SDKAbortError`, `name === 'AbortError'`, `.cause` = abort reason |
| `INTERNAL` | anything else, e.g. an unreadable response |

- `SDKServiceError` (API error status) adds `.status` and `.apiErrorCode` (the API's `detailedError.code`, when
  given); a `429` gets a standard `.message`, every other status keeps the API's.
- **Private Preview APIs** (`calculateReachableRange(s)`): an `INSUFFICIENT_PERMISSIONS` that is not `'InvalidReferer'`
  also carries `.privatePreviewAccess: { product, requestAccessURL }`, and its `.message` ends with the same plus
  the [Private Preview terms](https://docs.tomtom.com/legal/private-preview) — show that to the developer rather
  than "check the API key".
- Under `createLatestRequest` a superseded call resolves `{ current: false }` instead, so the
  `ABORTED` that still reaches a `catch` is your own deadline.
- The map reports its failures with the same codes, as `TomTomMapError` (`map-setup.md` § Map errors).

```ts
import { discoverPlaces, SDKError } from '@tomtom-org/maps-sdk/services';

try {
    const results = await discoverPlaces({
        query: 'coffee',
        geoBias: { position: [4.9, 52.4] },
        signal: AbortSignal.timeout(5000),
    });
} catch (error) {
    if (!(error instanceof SDKError)) throw error;

    switch (error.code) {
        case 'ABORTED': console.error('Search timed out'); break;
        case 'INVALID_REQUEST': console.error('Bad request — check parameters', error.issues); break;
        case 'INVALID_CREDENTIALS': console.error('API key missing, invalid or expired'); break;
        case 'INSUFFICIENT_PERMISSIONS': console.error('API key not allowed this API or domain:', error.message); break;
        case 'RATE_LIMITED': console.error('Rate limited, even after retrying'); break;
        case 'NETWORK_NOT_AVAILABLE': console.error('No connection'); break;
        default: console.error(`${error.service} failed (${error.code}, SDK ${error.sdkVersion}):`, error.message);
    }
}
```

**Tip:** `geocodeOne()` and `discoverOnePlace()` reject with a `NOT_FOUND` `SDKError` if no result — use `geocode()` / `discoverPlaces()`, or catch `error.code === 'NOT_FOUND'`, when the query might not be found. The arguments all four take: `places.md` § Search → display on map.

See [Request options and errors](https://docs.tomtom.com/maps-sdk-js/guides/services/request-options-and-errors.md).
