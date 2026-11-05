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

import { createServer, type Server } from "node:http";
import { ENDPOINT_METRICS } from "../constants";
import { metricsRegistry } from "./metrics";

export function startMetricsServer(port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.url !== `/${ENDPOINT_METRICS}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": metricsRegistry.contentType });
    res.end(await metricsRegistry.metrics());
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
