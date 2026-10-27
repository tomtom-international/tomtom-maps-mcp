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
 */

import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./createServer";
import { cannedApiResponse } from "./services/shared/cannedApiResponses";
import { recordFetch } from "./services/shared/recordFetch";
import { AI_CLIENTS, CLIENTS_WITHOUT_VALID_NAME } from "./testClients";
import { CACHED_AFTER_FIRST_CALL, TOOL_CALLS_REACHING_TOMTOM } from "./tools/toolBaselines";
import { VERSION } from "./version";

async function callToolOverStdio(clientName: string, tool: string, args: Record<string, unknown>) {
  const server = await createServer();
  // Without MCP Apps a known text-only client like claude-code gets no map tools
  const client = new Client(
    { name: clientName, version: "1.0.0" },
    { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.callTool({ name: tool, arguments: args });
  await client.close();
}

describe("every TomTom call over stdio names the client in its user agent", () => {
  beforeEach(() => {
    vi.stubEnv("TOMTOM_API_KEY", "offline-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe.each([...AI_CLIENTS, ...CLIENTS_WITHOUT_VALID_NAME])(
    "client $name",
    ({ name, userAgentToken }) => {
      it.each(TOOL_CALLS_REACHING_TOMTOM)("%s", async (tool, args) => {
        const requests = recordFetch(cannedApiResponse);

        await callToolOverStdio(name, tool, args);

        if (!CACHED_AFTER_FIRST_CALL.has(tool)) expect(requests.length).toBeGreaterThan(0);
        for (const request of requests) {
          expect(request.headers.get("tomtom-user-agent")).toBe(
            `TomTomMCPSDK/${VERSION} ${userAgentToken}`
          );
        }
      });
    }
  );
});
