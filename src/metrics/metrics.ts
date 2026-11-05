/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { collectDefaultMetrics, Gauge, Registry } from "prom-client";
import { readVersion } from "../utils/readVersion";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// Joined on by queries that split a metric per version, so no other metric carries one
new Gauge({
  name: "mcp_build_info",
  help: "The running server's version, always 1",
  labelNames: ["version"],
  registers: [metricsRegistry],
}).set({ version: readVersion() }, 1);
