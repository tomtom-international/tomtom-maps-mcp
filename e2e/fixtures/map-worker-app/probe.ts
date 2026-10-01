/**
 * Shape the fixture app exposes on `window` for the worker e2e test to read.
 * Types only — the spec imports this from Node, so it must never pull in
 * maplibre-gl or any other browser code.
 */
export interface MapWorkerProbe {
  /** Set once the map has fired its `load` event and the probe layer is added. */
  mapLoaded: boolean;
  /** Whether MapLibre considers the probe's GeoJSON source fully loaded. */
  sourceLoaded: () => boolean;
  /** Features MapLibre actually rendered — zero means the worker never parsed. */
  renderedFeatures: () => number;
  /** Errors emitted by the map. */
  errors: string[];
}

/** Key the fixture app assigns the probe to. */
export const PROBE_KEY = "mapWorkerProbe";

export type ProbeWindow = Window & { [PROBE_KEY]?: MapWorkerProbe };
