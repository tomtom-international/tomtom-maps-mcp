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

import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionKey } from "./clientSession";
import { RequestContextHolder } from "./requestContextHolder";
import { logRequests } from "./requestLog";
import { logger } from "./utils/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = "server-secret";
const GATEWAY_TRACKING_ID = "c65832be-3d4f-9840-b09f-8987713eb109";

function requestCompletedLines(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(logger, "info").mockImplementation((fields, message?: string) => {
    if (message === "Request completed") {
      lines.push({ ...RequestContextHolder.current(), ...(fields as object) });
    }
  });
  return lines;
}

async function send(headers: Record<string, string>, handler: express.RequestHandler) {
  const app = express();
  app.get("/logged", logRequests(SECRET), handler);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://localhost:${port}/logged`, { headers });
    await response.text();
    return response;
  } finally {
    server.close();
  }
}

const noContent: express.RequestHandler = (_request, response) => {
  response.status(204).end();
};

describe("logRequests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the request once it is answered, with its id, user agent, path, status and duration", async () => {
    const lines = requestCompletedLines();

    const response = await send(
      { "Tracking-Id": GATEWAY_TRACKING_ID, "User-Agent": "probe-agent" },
      noContent
    );

    expect(response.headers.get("tracking-id")).toBe(GATEWAY_TRACKING_ID);
    await vi.waitFor(() =>
      expect(lines).toEqual([
        {
          trackingId: GATEWAY_TRACKING_ID,
          user_agent: "probe-agent",
          path: "/logged",
          status: 204,
          durationMs: expect.any(Number),
        },
      ])
    );
  });

  it("mints a tracking id when the request carries none the gateway would keep", async () => {
    const lines = requestCompletedLines();

    const response = await send({ "Tracking-Id": "has space!" }, noContent);

    expect(response.headers.get("tracking-id")).toMatch(UUID);
    await vi.waitFor(() =>
      expect(lines).toEqual([
        expect.objectContaining({ trackingId: response.headers.get("tracking-id") }),
      ])
    );
  });

  it.each([
    [{ "Mcp-Session-Id": "mcp-session", "x-openai-session": "chatgpt" }, "mcp-session"],
    [{ "x-openai-session": "chatgpt" }, "chatgpt"],
  ])(
    "keys the session from Mcp-Session-Id, else from x-openai-session: %o",
    async (headers, id) => {
      const lines = requestCompletedLines();

      await send(headers, noContent);

      await vi.waitFor(() =>
        expect(lines).toEqual([expect.objectContaining({ session: sessionKey(id, SECRET) })])
      );
    }
  );

  it("adds what the handler records about the MCP request", async () => {
    const lines = requestCompletedLines();

    await send({}, (_request, response) => {
      response.locals.mcpRequest = {
        method: "tools/list",
        apps: "text-only",
        appsChosen: false,
        auth: "tomtom-api-key",
      };
      response.status(200).end();
    });

    await vi.waitFor(() =>
      expect(lines).toEqual([
        expect.objectContaining({
          method: "tools/list",
          apps: "text-only",
          appsChosen: false,
          auth: "tomtom-api-key",
          status: 200,
        }),
      ])
    );
  });
});
