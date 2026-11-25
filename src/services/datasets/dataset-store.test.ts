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

vi.mock("../base/tomtomClient", () => ({
  getEffectiveApiKey: () => mockGetEffectiveApiKey(),
}));

const { DATASET_TTL_SECONDS } = await import("../../schemas/datasets/datasetLifetime");
const { clearDatasetStore, getDataset, getDatasetStoreStats, missingDatasetError, storeDataset } =
  await import("./dataset-store");

const fc = (count: number) => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [i / 10, 50 + i / 10] },
    properties: { name: `p${i}`, status: i % 2 ? "Open" : "Closed" },
  })),
});

const provenance = { tool: "tomtom-discover-places" as const, params: { query: "cafe" } };

describe("dataset store", () => {
  beforeEach(() => {
    clearDatasetStore();
    mockGetEffectiveApiKey.mockReturnValue("key-alice");
  });

  it("stores a dataset and reads it back by id", () => {
    const stored = storeDataset(fc(3), provenance);

    expect(stored.id).toMatch(/^ds_[0-9a-f]{16}$/);
    const read = getDataset(stored.id);
    expect(read?.features).toHaveLength(3);
    expect(read?.provenance).toEqual(provenance);
  });

  it("computes the summary once, at write time", () => {
    const stored = storeDataset(fc(5), provenance);

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
    const stored = storeDataset(fc(1), provenance);

    mockGetEffectiveApiKey.mockReturnValue("key-bob");
    expect(getDataset(stored.id)).toBeUndefined();

    // …and the owner still sees it, so this is scoping and not eviction.
    mockGetEffectiveApiKey.mockReturnValue("key-alice");
    expect(getDataset(stored.id)).toBeDefined();
  });

  it("never stores the API key itself", () => {
    const stored = storeDataset(fc(1), provenance);

    expect(stored.owner).not.toContain("key-alice");
    expect(stored.owner).toMatch(/^[0-9a-f]{16}$/);
  });

  it("collapses a missing key to a single anonymous owner (stdio)", () => {
    mockGetEffectiveApiKey.mockReturnValue(undefined);
    const stored = storeDataset(fc(1), provenance);

    expect(stored.owner).toBe("anonymous");
    expect(getDataset(stored.id)).toBeDefined();
  });

  it("redacts the API key the SDK echoes into features", () => {
    const data = fc(1);
    (data.features[0].properties as Record<string, unknown>).apiKey = "key-alice";
    const stored = storeDataset(data, provenance);

    expect(JSON.stringify(stored.data)).not.toContain("key-alice");
  });

  it("names the producing call once the data expires, to its owner only", () => {
    const stored = storeDataset(fc(1), provenance);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + (DATASET_TTL_SECONDS + 1) * 1000);

    expect(getDataset(stored.id)).toBeUndefined();
    expect(missingDatasetError(stored.id).data).toMatchObject({
      producedBy: { tool: "tomtom-discover-places" },
    });
    mockGetEffectiveApiKey.mockReturnValue("key-bob");
    expect(missingDatasetError(stored.id).data).not.toHaveProperty("producedBy");

    vi.mocked(Date.now).mockRestore();
  });

  it("restarts a dataset's lifetime each time it is read", () => {
    const stored = storeDataset(fc(1), provenance);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");

    clock.mockReturnValue(now + (DATASET_TTL_SECONDS - 1) * 1000);
    expect(getDataset(stored.id)).toBeDefined();
    clock.mockReturnValue(now + (2 * DATASET_TTL_SECONDS - 2) * 1000);
    expect(getDataset(stored.id)).toBeDefined();
    clock.mockReturnValue(now + 3 * DATASET_TTL_SECONDS * 1000);
    expect(getDataset(stored.id)).toBeUndefined();

    clock.mockRestore();
  });

  it("counts a dataset's geometry in its size", () => {
    const coordinates = Array.from({ length: 39_000 }, (_, i) => [4.9 + i / 1e5, 52.37 + i / 1e5]);
    const route = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} },
      ],
    };

    const stored = storeDataset(route, { tool: "tomtom-plan-route", params: {} });

    expect(stored.bytes).toBe(JSON.stringify(getDataset(stored.id)?.data).length);
    expect(stored.bytes).toBeGreaterThan(39_000 * 2 * 7);
  });

  it("reports entry and byte totals", () => {
    storeDataset(fc(2), provenance);
    storeDataset(fc(2), provenance);

    const stats = getDatasetStoreStats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it("clears everything", () => {
    const stored = storeDataset(fc(1), provenance);
    clearDatasetStore();
    expect(getDataset(stored.id)).toBeUndefined();
    expect(getDatasetStoreStats().entries).toBe(0);
  });

  // The global budget bounds the PROCESS and nothing else. Without a per-owner
  // ceiling, one caller filling it would evict everyone, and the victim's handle
  // would stop resolving as though it had expired.
  describe("per-owner budget", () => {
    it("evicts the heavy owner's own datasets, not another owner's", () => {
      mockGetEffectiveApiKey.mockReturnValue("key-bob");
      const bobs = storeDataset(fc(1), provenance);

      // Alice pushes well past her own entry ceiling.
      mockGetEffectiveApiKey.mockReturnValue("key-alice");
      const alices: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        alices.push(storeDataset(fc(1), provenance).id);
      }

      // Bob's dataset survives Alice's flood…
      mockGetEffectiveApiKey.mockReturnValue("key-bob");
      expect(getDataset(bobs.id)).toBeDefined();

      // …and Alice is trimmed to her own ceiling, oldest of hers first.
      mockGetEffectiveApiKey.mockReturnValue("key-alice");
      expect(getDataset(alices[0])).toBeUndefined();
      expect(getDataset(alices[alices.length - 1])).toBeDefined();
    });

    it("evicts the dataset read longest ago, not the one stored first", () => {
      const source = storeDataset(fc(1), provenance);
      const unread = storeDataset(fc(1), provenance);
      for (let i = 0; i < 98; i += 1) storeDataset(fc(1), provenance);

      getDataset(source.id);
      storeDataset(fc(1), provenance);

      expect(getDataset(source.id)).toBeDefined();
      expect(getDataset(unread.id)).toBeUndefined();
    });

    it("keeps a light owner's dataset readable while a heavy one churns", () => {
      mockGetEffectiveApiKey.mockReturnValue("key-carol");
      const carols = storeDataset(fc(3), provenance);

      mockGetEffectiveApiKey.mockReturnValue("key-dave");
      for (let i = 0; i < 150; i += 1) {
        storeDataset(fc(2), provenance);
      }

      mockGetEffectiveApiKey.mockReturnValue("key-carol");
      expect(getDataset(carols.id)?.summary.count).toBe(3);
    });
  });
});

describe("held places", () => {
  beforeEach(() => clearDatasetStore());

  it("carry each connector's fields flat, as the trimmed result shows them, without changing the caller's data", () => {
    const station = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [5, 52] },
      properties: {
        chargingPark: {
          connectors: [{ connector: { type: "Chademo", ratedPowerKW: 50 }, count: 2 }],
        },
      },
    };
    const data = { type: "FeatureCollection", features: [station] };
    const stored = storeDataset(data, provenance);

    expect(stored.features[0].properties?.chargingPark.connectors[0]).toMatchObject({
      type: "Chademo",
      ratedPowerKW: 50,
      count: 2,
      connector: { type: "Chademo" },
    });
    expect(station.properties.chargingPark.connectors[0]).not.toHaveProperty("ratedPowerKW");
  });
});
