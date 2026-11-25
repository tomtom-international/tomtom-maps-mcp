/*
 * Copyright (C) 2025 TomTom Navigation B.V.
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
 *
 * Preloaded into the spawned server (`node --import`) to count the requests it
 * sends to TomTom, which are what a question costs in quota. It wraps the global
 * `fetch`, which both the maps-sdk and the server's own HTTP helper call, so it
 * counts any checkout the same way without touching its code.
 *
 * One line per request goes to `EVAL_UPSTREAM_LOG`: host and path only, since
 * the query string carries the API key.
 */

import { appendFileSync } from "node:fs";

const log = process.env.EVAL_UPSTREAM_LOG;

if (log) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname.endsWith("tomtom.com")) {
      appendFileSync(log, `${url.hostname}${url.pathname}\n`);
    }
    return originalFetch(input, init);
  };
}
