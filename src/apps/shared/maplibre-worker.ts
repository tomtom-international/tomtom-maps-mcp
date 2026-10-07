/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "./maplibre-worker-url";

/**
 * Points MapLibre at its worker on the CDN it was loaded from.
 *
 * Left unset, the maps-sdk registers the worker Vite emits next to the bundle,
 * which a single-file MCP App does not ship: the worker never starts, every
 * source stays unparsed and the map renders blank while still firing `load`.
 * MapLibre starts a worker from another origin through a blob that imports it.
 *
 * Call before creating a map — MapLibre reads the URL when it spawns its pool.
 */
export function useCdnMaplibreWorker(): void {
  if (workerUrl) setWorkerUrl(workerUrl);
}
