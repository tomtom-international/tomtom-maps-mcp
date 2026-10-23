# Agent Toolkit — BYOD (bring-your-own-data)

Customer GeoJSON registered as `byod` entries — fetched from a URL, passed inline, or added by your app.
Tools: `addByodSource`, `setByodLayers`, `updateByodDisplay`.
See [tools.md](./tools.md) for the registry, [state.md](./state.md) for the `byod` slice,
[data-tools.md](./data-tools.md) for `byod` entries as `analyseData` / `processData` inputs.

---

## Tools

```ts
addByodSource({ label, url?, data?, entryId? });   // exactly one of url / data
// → { byodEntryId, label, source: { kind: 'url', url } | { kind: 'inline' }, profile }

setByodLayers({
    byodEntryId,
    layers: [{ type, paint?, layout?, filter?, id?, beforeID? }], // ≥ 1; replaces the entry's layers
    show?: { zoomMode: 'auto' | 'none', hidePreviousEntries?: 'all' | string[] }, // render a hidden entry / re-fit
});
// → { layerCount, layerTypes, shown? }

updateByodDisplay({ action: 'show' | 'hide' | 'remove', entryIds?, hideOthers?, clearAll? });
// hideOthers: show only; clearAll: hide only — hides every shown entry
// → { affectedIds, shown }
```

From app code: `await agent.state.byod.addEntry(featureCollection, 'Depots', { layers?, source?, explicitId? })`;
it renders nothing until `await agent.state.byod.showEntry(id)`, which draws it with those `layers`.

## Profile

Every ingest path infers a `BYODDataProfile` locally, in one pass: `featureCount`, `geometryTypes`, and per property
`name`, JSON `types`, `coverage` and capped `examples` (`propertiesOmitted` when capped). `addByodSource` returns it;
`recallState({ kind: 'byod' })` lists `propertyNames`, and `{ kind: 'byod', id }` returns the profile.

## Untrusted data

Model-facing results get a safe profile: **string** example values are withheld (prompt-injection vector),
`name` / `types` / `coverage` and numeric / boolean examples stay. `recallState` never returns the raw `FeatureCollection`;
the full profile stays on the entry for your UI. The model computes over values with `analyseData` / `processData`.

## URL fetch policy

Every URL fetch: http(s) only, 25 MB cap, 15 s timeout, `credentials: 'omit'`, `redirect: 'error'`. Any fetch
failure (network, HTTP status, size, timeout, redirect, non-JSON, not a FeatureCollection) returns one generic error to
the model — no status, body fragment or host-existence signal.

Default policy (no `validateSourceUrl`): **public `https:` URLs only**. Refused before any request: `http:`, the page's
own origin, `localhost` / `*.localhost` / `*.local` / `*.localdomain` / `*.internal` / `*.home.arpa` / single-label hostnames, and loopback, private
(RFC 1918, `fc00::/7`), link-local (`169.254/16` — cloud metadata — and `fe80::/10`) and other non-public IP literals.
No DNS resolution in the browser, so a public hostname resolving to a private address passes.

`validateSourceUrl` **replaces** the default policy (the fetch limits above still apply):

```ts
createMapAgent(map, {
    model,
    byod: {
        validateSourceUrl: (url) =>
            url.protocol === 'https:' && url.hostname === 'data.example.com'
                ? { valid: true }
                : { valid: false, reason: 'Host not allowed' },
    },
});
```

- `url` is a `URL`; sync or async; runs after the http(s) check, before the fetch.
- To load from your own origin or a local dev server (`http://localhost:…`), allow exactly those URLs here.
- `reason` is surfaced to the model as the tool error. Inline `data` is not gated.
- Stored on `state.byod.sourceUrlValidator`.

## Layers

A new entry has **no layers** (unless your app's `addEntry` passed some) and renders nothing. The model picks them from
the profile with `setByodLayers` — its only way to make an entry visible: graduate `circle-radius` by a number, colour a `fill` / `line` by category, switch points to
`symbol`, …

- `type` must suit the geometry: points → `circle` / `symbol` / `heatmap`, lines → `line`, polygons → `fill` / `fill-extrusion`.
- On a shown entry the new layers apply live; `show` renders a hidden one or re-fits the camera.
- An invalid spec is rejected with a semantic error and the previous layers stay.

### Layer placement (`beforeID`)

A style layer id to draw **below**; omit for the top. Prefer the SDK's `mapStyleLayerIDs` anchors, as raw names (the
schema is a plain string): `'Borders - Treaty label'` (`lowestLabel`) for fill / line / heatmap so labels stay above,
`'Tunnel - Railway outline'` (`lowestRoadLine`) when roads should paint over a fill; omit for points.
An id absent from the current style puts the layer on top.

## Disabling BYOD

```ts
createMapAgent(map, {
    model,
    dataEntries: {
        byod: { enabled: false }, // drops byod from analyseData / processData
                                  // and removes addByodSource / setByodLayers / updateByodDisplay
    },
});
```
