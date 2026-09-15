/**
 * Fixture app for the MapLibre worker e2e test.
 *
 * It imports maplibre-gl the same way the real MCP Apps do and is built through
 * the same single-file Vite config, so it stands in for any of them. The style
 * is inline and the data is local: the probe must not need an API key or any
 * network access, only the worker.
 */
import { Map as MapLibreMap } from "maplibre-gl";
import { useInlinedMaplibreWorker } from "@shared/maplibre-worker";
import type { MapWorkerProbe, ProbeWindow } from "./probe";

const SOURCE_ID = "probe-points";
const LAYER_ID = "probe-circles";

const errors: string[] = [];

useInlinedMaplibreWorker();

const map = new MapLibreMap({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [0, 0],
  zoom: 4,
  attributionControl: false,
});

const probe: MapWorkerProbe = {
  mapLoaded: false,
  sourceLoaded: () => Boolean(map.getSource(SOURCE_ID)) && map.isSourceLoaded(SOURCE_ID),
  renderedFeatures: () =>
    map.getLayer(LAYER_ID) ? map.queryRenderedFeatures({ layers: [LAYER_ID] }).length : 0,
  errors,
};
(window as ProbeWindow).mapWorkerProbe = probe;

map.on("error", (event: unknown) => {
  const err = (event as { error?: Error })?.error;
  errors.push(err?.message ?? String(event));
});

map.on("load", () => {
  // A GeoJSON source is the cheapest way to make the worker do real work:
  // MapLibre hands the data to the worker to cut into tiles, so if the worker
  // never starts, the source stays unloaded and no feature is ever rendered.
  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        [0, 0],
        [0.2, 0.2],
        [-0.2, -0.2],
      ].map(([lng, lat]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
      })),
    },
  });
  map.addLayer({
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: { "circle-radius": 20 },
  });
  probe.mapLoaded = true;
});
