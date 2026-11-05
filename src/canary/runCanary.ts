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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger";
import { readVersion } from "../utils/readVersion";
import { CANARY_CASES, type CanaryCase } from "./canaryCases";

// clientFamily() files this name under "canary", which dashboards leave out by default
const CANARY_CLIENT_NAME = "tomtom-mcp-canary";
const SLOW_CASE_MS = 5000;

export async function runCanary(
  url: string,
  apiKey: string,
  cases: CanaryCase[] = CANARY_CASES
): Promise<boolean> {
  const client = new Client({ name: CANARY_CLIENT_NAME, version: readVersion() });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { "tomtom-api-key": apiKey } },
    })
  );
  let passed = true;
  for (const canaryCase of cases) {
    const started = performance.now();
    const failures = await failuresOf(client, canaryCase);
    const durationMs = Math.round(performance.now() - started);
    const pass = failures.length === 0;
    passed &&= pass;
    (pass ? logger.info : logger.error).call(
      logger,
      { case: canaryCase.tool, pass, durationMs, slow: durationMs > SLOW_CASE_MS, failures },
      "Canary result"
    );
  }
  await client.close();
  return passed;
}

async function failuresOf(client: Client, { tool, arguments: args, check }: CanaryCase) {
  try {
    const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    const text = result.content.find((part) => part.type === "text")?.text ?? "";
    return result.isError ? [`tool answered with an error: ${text}`] : check(JSON.parse(text));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
