# Route Dragging Plugin Reference

Edits a route on a `RoutingModule` by dragging: a waypoint's pin moves its stop, a route line pulls a new stop off it, and the routes re-plan while the drag lasts, their answers shown in order.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-route-dragging`.

## Imports

```ts
import {
    RouteDragging,
    type RouteDraggingOptions,
    type RouteDraggingPlanner,
    type WaypointDrag,
    type WaypointDragKind,
} from '@tomtom-org/maps-sdk-plugin-route-dragging';
```

## Installation

```bash
npm i @tomtom-org/maps-sdk maplibre-gl @tomtom-org/maps-sdk-plugin-route-dragging
```

`@tomtom-org/maps-sdk` (`>=1.0.0-rc.4`) and `lodash-es` are peer dependencies; the plugin bundles neither. `lodash-es` is one of the SDK's own peers, so it installs with the SDK. Guide: [Route dragging plugin](https://docs.tomtom.com/maps-sdk-js/guides/plugins/route-dragging.md).

## Quick start

```ts
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { RoutingModule, TomTomMap } from '@tomtom-org/maps-sdk/map';
import { RouteDragging } from '@tomtom-org/maps-sdk-plugin-route-dragging';

TomTomConfig.instance.put({ apiKey: 'YOUR_API_KEY' });

const map = new TomTomMap({ mapLibre: { container: 'map', center: [4.9, 52.2], zoom: 8 } });
const routing = await RoutingModule.create(map);
const dragging = new RouteDragging(routing, {
    onRoutes: (routes) => showSummary(routes.features[0].properties.summary),
});

// Shows the pins and plans the route; from here the user drags pins and lines.
await dragging.setWaypoints([
    [4.8897, 52.3731], // Amsterdam
    [5.1214, 52.0907], // Utrecht
    [4.4777, 51.9244], // Rotterdam
]);
```

The plugin registers the `dragstart` / `drag` / `dragend` handlers on `routing.events.waypoints` and `routing.events.mainLines` itself (`user-events.md`, *Dragging*), so pins and lines show `cursorOnDraggable` and the map doesn't pan under the drag. Write no pointer handling of your own.

## Options

| Option | Meaning | Default |
|---|---|---|
| `plan` | `RouteDraggingPlanner`, `(locations, signal) => Promise<Routes>`; `false` plans nothing | `calculateRoute({ locations, signal })` |
| `planIntervalMS` | how often the routes re-plan while a drag lasts (throttled); the drop always plans once more | `500` |
| `insertFromRouteLines` | dragging a route line pulls a new waypoint off it, between the stops its detour fits best, never before the origin or after the destination; `false` keeps the lines still | `true` |
| `showOnMap` | the plugin shows the dragged waypoints and the planned routes on the routing module | `true` |
| `onWaypointsChange(waypoints, drag)` | every step of a drag, with the waypoints it leaves and a `WaypointDrag` | — |
| `onRoutes(routes, waypoints)` | each planned answer, in order, with the waypoints it was planned for | — |
| `onError(error)` | a failed plan | a `console.warn` |

```ts
type WaypointDrag = {
    type: 'dragstart' | 'drag' | 'dragend'; // DragEventType: once, every move, the drop
    kind: WaypointDragKind;                 // 'move' (a pin) | 'insert' (a stop pulled off a line), for every step of that drag
    waypointIndex: number;                  // index in the waypoints, null placeholders included; for 'insert', where it was inserted
    position: Position;                     // [longitude, latitude] of the dragged waypoint now
};
```

| Member | Effect |
|---|---|
| `setWaypoints(waypoints)` | `routing.showWaypoints` them and plan the routes through them |
| `getWaypoints()` | the waypoints as the routing module last showed them or a drag left them |
| `dragging` | whether a waypoint is being dragged |
| `remove()` | stop listening to the routing module, cancel the throttled plan and drop the plans in flight |

## Your own planner

```ts
import { calculateRoute } from '@tomtom-org/maps-sdk/services';

new RouteDragging(routing, {
    plan: (locations, signal) => calculateRoute({ locations, signal, travelMode: 'truck', maxAlternatives: 2 }),
});
```

- `locations` are the waypoints without their `null` placeholders. A moved stop keeps its id and properties, so its `pauseDurationSeconds` and the like still plan.
- The requests overlap rather than cancel each other (`createLatestRequest({ supersede: 'on-answer' })`, `services-config.md`): a route slower than `planIntervalMS` still shows mid-drag, and an older answer arriving after a newer one is dropped. To send fewer requests, raise `planIntervalMS`.

## Headless: your app owns the state (`showOnMap: false`)

For a React, Vue or store-driven app. The plugin shows nothing itself; apply what it reports and show it yourself.

```ts
const dragging = new RouteDragging(routing, {
    showOnMap: false,
    onWaypointsChange: (waypoints, { type, kind, waypointIndex, position }) => {
        if (kind === 'insert' && type === 'dragstart') store.insertStop(waypointIndex, position);
        else store.moveStop(waypointIndex, position);
    },
    onRoutes: (routes) => store.setLiveRoutes(routes),
});

// Your render shows the stops; the plugin follows whatever the routing module shows (its `shown-features`).
await routing.showWaypoints(store.waypoints);
// And shows the routes planned mid-drag, or hands them to your own route state.
await routing.showRoutes(store.liveRoutes);
```

- Show the stops with `routing.showWaypoints`, not `setWaypoints`, which shows them even in this mode.
- Hold back your own route planning while `dragging.dragging` is true, and plan again on the drop (`type === 'dragend'`), or keep the routes `onRoutes` gave you until your own plan answers.
- Clean up with `remove()`, in React from the `useEffect` that created it.

## Gotchas

- **Indexes are those of the waypoints the routing module last showed, `null` placeholders included** — the same as `waypoint.properties.index` on its events. Map them to your stops through that list, not the filled locations.
- **Apply every reported change**, each `drag` included. An `'insert'` is already in the waypoints at `waypointIndex` from its `dragstart`, and its later steps move that index. A re-show of stops that missed a change puts the plugin's indexes out of step with your stops.
- **A moved stop is a bare waypoint at the drop**, with only the moved stop's `id`, `pauseDurationSeconds` and `legCostModel`. Its address, POI and entry points stay behind, so a dragged POI stop no longer routes to the POI. Look the new spot up yourself (for example with `reverseGeocode`) to name it.
- **Pass the `signal`** your `plan` receives to every call it makes. The plugin aborts a plan once a newer answer is in; without the signal the request runs to the end for nothing.
- **`plan: false`** plans nothing and `onRoutes` never fires: you get only `onWaypointsChange`, and plan on `dragend` yourself.
- **Fewer than two locations** plans nothing; with `showOnMap` the plugin clears the routes. A drop that moved nothing plans nothing more.
