/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { setWorkerUrl } from "maplibre-gl";
import workerSource from "./maplibre-worker-source";

let workerUrl: string | undefined;

// A single-file app ships no worker beside it, and ChatGPT's `worker-src blob:`
// also forbids a blob worker that imports from the CDN, so the whole worker
// runs from one blob. Call before creating a map: MapLibre reads the URL when
// it spawns its pool.
export function useInlinedMaplibreWorker(): void {
  if (!workerSource || workerUrl) return;
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  setWorkerUrl(workerUrl);
}
