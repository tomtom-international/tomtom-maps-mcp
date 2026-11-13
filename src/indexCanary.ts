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
import { runCanary } from "./canary/runCanary";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  const url = process.env.CANARY_MCP_URL;
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!url || !apiKey) {
    logger.error(
      "Canary not started: set CANARY_MCP_URL to the MCP server to check, and TOMTOM_API_KEY to the key it calls with"
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = (await runCanary(url, apiKey)) ? 0 : 1;
}

main();
