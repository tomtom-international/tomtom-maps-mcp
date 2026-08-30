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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/api-key", () => ({
  getEffectiveApiKey: () => "key-test",
}));

const { describeDatasetHandler } = await import("./describe-dataset");
const { clearDatasetStore, storeDataset } = await import("../../services/datasets/dataset-store");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const fc = (count: number) => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [4 + i / 100, 52 + i / 100] },
    properties: { poi: { name: `Cafe ${i}` }, open: i % 2 === 0 },
  })),
});

describe("describeDatasetHandler", () => {
  beforeEach(() => clearDatasetStore());

  it("describes a held dataset without returning the data", async () => {
    const stored = storeDataset({
      data: fc(250),
      kind: "places",
      provenance: { tool: "tomtom-poi-search", params: { query: "cafe" } },
    });

    const result = await describeDatasetHandler({ dataset_id: stored.id });
    const body = parse(result);

    expect(result.isError).toBeUndefined();
    expect(body.dataset_id).toBe(stored.id);
    expect(body.producedBy).toBe("tomtom-poi-search");
    expect(body.count).toBe(250);
    expect(body.properties["poi.name"].type).toBe("string");
    expect(body.properties.open.values).toEqual([false, true]);
    // The whole point: a 250-feature dataset is described, not transferred.
    expect(body.sample).toHaveLength(2);
  });

  it("honours a larger sample without changing the summary", async () => {
    const stored = storeDataset({
      data: fc(20),
      kind: "places",
      provenance: { tool: "tomtom-poi-search", params: {} },
    });

    const body = parse(await describeDatasetHandler({ dataset_id: stored.id, sample: 5 }));
    expect(body.sample).toHaveLength(5);
    expect(body.count).toBe(20);
  });

  it("reports an actionable error for an unknown or expired id", async () => {
    const result = await describeDatasetHandler({ dataset_id: "ds_nope" });

    expect(result.isError).toBe(true);
    const { error } = parse(result);
    expect(error).toContain("not available");
    // Tells the model what to do next rather than just failing.
    expect(error).toContain("Re-run the tool");
  });

  it("reports the dataset's age so staleness is visible", async () => {
    const stored = storeDataset({
      data: fc(1),
      kind: "places",
      provenance: { tool: "tomtom-geocode", params: {} },
    });

    const body = parse(await describeDatasetHandler({ dataset_id: stored.id }));
    expect(body.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(body.ageSeconds).toBeLessThan(5);
  });
});
