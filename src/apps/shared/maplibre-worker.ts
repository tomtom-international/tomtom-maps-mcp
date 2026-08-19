/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { setWorkerUrl } from "maplibre-gl";
import workerSource from "./maplibre-worker-source";

let workerUrl: string | undefined;

/**
 * Points MapLibre at a worker blob built inside the page.
 *
 * MapLibre resolves its worker from a URL next to its own module. An MCP App is
 * a single inlined HTML file, so there is no sibling to fetch: without this the
 * worker never starts, every source stays unparsed and the map renders blank
 * while still firing `load`. The app build inlines the worker source so it can
 * be handed over as a blob instead.
 *
 * Call before creating a map — MapLibre reads the URL when it spawns its pool.
 */
export function useInlinedMaplibreWorker(): void {
  if (!workerSource || workerUrl) return;
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  setWorkerUrl(workerUrl);
}
