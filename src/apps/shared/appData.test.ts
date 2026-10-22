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

import type { App } from "@modelcontextprotocol/ext-apps";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DATA_META_KEY } from "../../constants";
import { buildCompressedResponse } from "../../handlers/shared/responseTrimmer";
import { trackAppData } from "./appData";

const appData = { results: [{ name: "Café André", position: [4.89707, 52.377956] }] };
const input = { query: "café", show_ui: true };
const agentResponse = { results: [], _meta: { show_ui: true, tool: "tomtom-fuzzy-search" } };
const dataVizResponse = { summary: {}, _meta: { show_ui: true, tool: "tomtom-data-viz" } };
const undecodable = { _meta: { [APP_DATA_META_KEY]: "bm90IGd6aXA=" } };

/** An App that has announced `input` and answers the get-app-data tool with `answer`. */
function fakeApp({
  answer = { content: [{ type: "text", text: JSON.stringify(appData) }] },
  refetch = false,
}: {
  answer?: unknown;
  refetch?: boolean;
} = {}) {
  const listeners: Record<string, (params: unknown) => void> = {};
  const callServerTool = vi.fn(
    async ({ name }: { name: string; arguments: Record<string, unknown> }) =>
      name === "tomtom-get-app-data" ? answer : { content: [] }
  );
  const app = {
    addEventListener: (event: string, listener: (params: unknown) => void) => {
      listeners[event] = listener;
    },
    callServerTool,
    sendLog: vi.fn(async () => {}),
  };
  const tracker = trackAppData(app as unknown as App, { refetch });
  listeners.toolinput({ arguments: input });
  const calls = (name: string) =>
    callServerTool.mock.calls.filter(([call]) => call.name === name).map(([call]) => call);
  return { tracker, calls };
}

describe("trackAppData", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("decodes the data the server inlined, without calling the server", async () => {
    const result = await buildCompressedResponse({ results: [] }, appData);
    const { tracker, calls } = fakeApp();

    expect(await tracker.load(result, JSON.parse(result.content[0].text))).toEqual(appData);
    expect(calls("tomtom-get-app-data")).toEqual([]);
  });

  it("fails, and never runs a TomTom tool again, when the result has no inline data", async () => {
    const { tracker, calls } = fakeApp();

    await expect(tracker.load({}, agentResponse)).rejects.toThrow(
      "The tool result carried no map data"
    );
    expect(calls("tomtom-get-app-data")).toEqual([]);
  });

  it("fails, and never runs a TomTom tool again, when the inline data can't be decoded", async () => {
    const { tracker, calls } = fakeApp();

    await expect(tracker.load(undecodable, agentResponse)).rejects.toThrow("could not be decoded");
    expect(calls("tomtom-get-app-data")).toEqual([]);
  });

  it("runs tomtom-data-viz again with its input when the result has no inline data", async () => {
    const { tracker, calls } = fakeApp({ refetch: true });

    expect(await tracker.load({}, dataVizResponse)).toEqual(appData);
    expect(calls("tomtom-get-app-data")).toEqual([
      {
        name: "tomtom-get-app-data",
        arguments: { tool: "tomtom-data-viz", arguments: input, reason: "not_inline" },
      },
    ]);
  });

  it("runs tomtom-data-viz again when the inline data can't be decoded", async () => {
    const { tracker, calls } = fakeApp({ refetch: true });

    await tracker.load(undecodable, dataVizResponse);

    expect(calls("tomtom-get-app-data")[0].arguments.reason).toBe("decode_failed");
  });

  it("draws the response itself when no tool is named, as under response_detail full", async () => {
    const full = { results: [{ name: "Café André" }], _meta: { show_ui: true } };
    const { tracker, calls } = fakeApp();

    expect(await tracker.load({}, full)).toBe(full);
    expect(calls("tomtom-get-app-data")).toEqual([]);
  });

  it("rejects when tomtom-data-viz can't be run again", async () => {
    const { tracker } = fakeApp({
      answer: { isError: true, content: [{ type: "text", text: "failed" }] },
      refetch: true,
    });

    await expect(tracker.load({}, dataVizResponse)).rejects.toThrow(
      "Failed to fetch the app data of tomtom-data-viz"
    );
  });

  it("reports a drawn app with where its data came from", async () => {
    const { tracker, calls } = fakeApp({ refetch: true });

    await tracker.load({}, dataVizResponse);
    tracker.drawn();

    expect(calls("tomtom-report-app-status")[0].arguments).toEqual({
      tool: "tomtom-data-viz",
      status: "drawn",
      source: "fetched",
      duration_ms: expect.any(Number),
    });
  });

  it("reports a failure while loading as a data failure, and later ones as draw failures", async () => {
    const { tracker, calls } = fakeApp();

    await tracker.load({}, agentResponse).catch((error) => tracker.failed(error));
    tracker.failed(new Error("WebGL context lost"));

    const reports = calls("tomtom-report-app-status").map((call) => call.arguments);
    expect(reports).toEqual([
      expect.objectContaining({ tool: "tomtom-fuzzy-search", status: "failed", stage: "data" }),
      expect.objectContaining({ status: "failed", stage: "draw", error: "WebGL context lost" }),
    ]);
  });
});
