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

const mockGetEffectiveApiKey = vi.fn(() => "key-alice" as string | undefined);

vi.mock("../api-key", () => ({
  getEffectiveApiKey: () => mockGetEffectiveApiKey(),
}));

const { clearDatasetStore, deleteDataset, getDataset, getDatasetStoreStats, storeDataset } =
  await import("./dataset-store");

const fc = (count: number) => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [i / 10, 50 + i / 10] },
    properties: { name: `p${i}`, status: i % 2 ? "Open" : "Closed" },
  })),
});

const provenance = { tool: "tomtom-poi-search", params: { query: "cafe" } };

describe("dataset store", () => {
  beforeEach(() => {
    clearDatasetStore();
    mockGetEffectiveApiKey.mockReturnValue("key-alice");
  });

  it("stores a dataset and reads it back by id", () => {
    const stored = storeDataset({ data: fc(3), kind: "places", provenance });

    expect(stored.id).toMatch(/^ds_[0-9a-f]{16}$/);
    const read = getDataset(stored.id);
    expect(read?.kind).toBe("places");
    expect(read?.provenance).toEqual(provenance);
  });

  it("computes the summary once, at write time", () => {
    const stored = storeDataset({ data: fc(5), kind: "places", provenance });

    expect(stored.summary.count).toBe(5);
    // The vocabulary is what makes generated code correct first time.
    expect(stored.summary.properties.status.values).toEqual(["Closed", "Open"]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getDataset("ds_doesnotexist")).toBeUndefined();
  });

  // The security property that matters once `dataset_id` is something the model
  // can pass to a read tool.
  it("hides another principal's dataset behind the same answer as a miss", () => {
    const stored = storeDataset({ data: fc(1), kind: "places", provenance });

    mockGetEffectiveApiKey.mockReturnValue("key-bob");
    expect(getDataset(stored.id)).toBeUndefined();

    // …and the owner still sees it, so this is scoping and not eviction.
    mockGetEffectiveApiKey.mockReturnValue("key-alice");
    expect(getDataset(stored.id)).toBeDefined();
  });

  it("never stores the API key itself", () => {
    const stored = storeDataset({ data: fc(1), kind: "places", provenance });

    expect(stored.owner).not.toContain("key-alice");
    expect(stored.owner).toMatch(/^[0-9a-f]{16}$/);
  });

  it("collapses a missing key to a single anonymous owner (stdio)", () => {
    mockGetEffectiveApiKey.mockReturnValue(undefined);
    const stored = storeDataset({ data: fc(1), kind: "places", provenance });

    expect(stored.owner).toBe("anonymous");
    expect(getDataset(stored.id)).toBeDefined();
  });

  it("refuses to delete a dataset the caller does not own", () => {
    const stored = storeDataset({ data: fc(1), kind: "places", provenance });

    mockGetEffectiveApiKey.mockReturnValue("key-bob");
    expect(deleteDataset(stored.id)).toBe(false);

    mockGetEffectiveApiKey.mockReturnValue("key-alice");
    expect(deleteDataset(stored.id)).toBe(true);
    expect(getDataset(stored.id)).toBeUndefined();
  });

  it("estimates a size that scales with feature count", () => {
    const small = storeDataset({ data: fc(2), kind: "places", provenance });
    const large = storeDataset({ data: fc(400), kind: "places", provenance });

    // Estimated from the sample, not by serialising the payload — see
    // estimateBytes for why. Only the ordering has to hold.
    expect(large.bytes).toBeGreaterThan(small.bytes);
    expect(small.bytes).toBeGreaterThanOrEqual(1024);
  });

  it("reports entry and byte totals", () => {
    storeDataset({ data: fc(2), kind: "places", provenance });
    storeDataset({ data: fc(2), kind: "places", provenance });

    const stats = getDatasetStoreStats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it("clears everything", () => {
    const stored = storeDataset({ data: fc(1), kind: "places", provenance });
    clearDatasetStore();
    expect(getDataset(stored.id)).toBeUndefined();
    expect(getDatasetStoreStats().entries).toBe(0);
  });

  // The global budget bounds the PROCESS and nothing else. One caller filling it
  // used to evict everyone: the victim's next analyse-data call returned
  // "not available (datasets live 30 minutes)", a correct message describing
  // something that had not happened. A per-owner ceiling makes a heavy caller pay
  // for their own allocation.
  describe("per-owner budget", () => {
    it("evicts the heavy owner's own datasets, not another owner's", () => {
      mockGetEffectiveApiKey.mockReturnValue("key-bob");
      const bobs = storeDataset({ data: fc(1), kind: "places", provenance });

      // Alice pushes well past her own entry ceiling.
      mockGetEffectiveApiKey.mockReturnValue("key-alice");
      const alices: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        alices.push(storeDataset({ data: fc(1), kind: "places", provenance }).id);
      }

      // Bob's dataset survives Alice's flood…
      mockGetEffectiveApiKey.mockReturnValue("key-bob");
      expect(getDataset(bobs.id)).toBeDefined();

      // …and Alice is trimmed to her own ceiling, oldest of hers first.
      mockGetEffectiveApiKey.mockReturnValue("key-alice");
      expect(getDataset(alices[0])).toBeUndefined();
      expect(getDataset(alices[alices.length - 1])).toBeDefined();
    });

    it("keeps a light owner's dataset readable while a heavy one churns", () => {
      mockGetEffectiveApiKey.mockReturnValue("key-carol");
      const carols = storeDataset({ data: fc(3), kind: "places", provenance });

      mockGetEffectiveApiKey.mockReturnValue("key-dave");
      for (let i = 0; i < 150; i += 1) {
        storeDataset({ data: fc(2), kind: "places", provenance });
      }

      mockGetEffectiveApiKey.mockReturnValue("key-carol");
      expect(getDataset(carols.id)?.summary.count).toBe(3);
    });
  });
});
