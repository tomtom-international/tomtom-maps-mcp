# 4. `geometry` returns a normalised GeoJSON FeatureCollection

- Status: accepted
- Date: 2026-09-24

## Context

[ADR 0003](0003-response-detail-geometry-value.md) adds `response_detail: "geometry"`. Its format is what integrators will parse.

The backends return geometry in different shapes today. Orbis returns GeoJSON. The TomTom Maps backend returns `{latitude, longitude}` point lists for routing and reachable range, and GeoJSON Features for traffic incidents.

Two formats were considered.

**GeoJSON (RFC 7946)**
- About 21 KB for Amsterdam–Berlin, simplified to 10 m.
- Every common map library draws it directly.
- It covers lines, polygons and points in one format.
- A model can read it.

**Encoded polyline (5 decimals)**
- About 5 KB for the same route.
- The integrator needs a decoding step.
- It suits lines only, so polygons and incidents would need a convention on top.
- It is opaque to a model.
- The token saving is smaller than the byte saving, because the encoded string splits into many tokens. This is an estimate.

## Decision

`geometry` returns an RFC 7946 GeoJSON FeatureCollection.

- **Same on both backends.** The shape is identical on `tomtom-maps` and `tomtom-orbis-maps`, whatever each API returns natively.
- **Axis order.** Coordinates are `[longitude, latitude]`.
- **Precision.** Coordinates are rounded to 5 decimal places, about 1.1 m.

Encoded polyline is not offered now. It can be added later as a format option if an integrator asks for it.

## Consequences

- Integrators write one parser for both backends and every geometry-bearing tool.
- The TomTom Maps backend needs a converter from point lists to GeoJSON. Existing code can be reused: `buildRouteFeatures` in `dynamicMapService.ts` and `normalizeToFeatureCollection` in `dataVizOrbisHandler.ts`.
- Payloads are about 4× larger than polyline. Size is controlled by simplification, which is a separate decision.
- The FeatureCollection shape must be documented and pinned by tests, because it becomes a contract.
