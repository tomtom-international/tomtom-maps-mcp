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

const mockApiKey = vi.fn(() => "key-test");
vi.mock("../../services/base/tomtomClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/base/tomtomClient")>()),
  getEffectiveApiKey: () => mockApiKey(),
}));

const { analyseDatasetsHandler } = await import("./analyse-datasets");
const { DATASET_TTL_SECONDS } = await import("../../schemas/datasets/datasetLifetime");
const { clearDatasetStore, getDataset, storeDataset } = await import(
  "../../services/datasets/dataset-store"
);

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** A traffic-shaped dataset — the case a trimmed response actively breaks. */
const incidents = (count: number) => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.8 + (i % 50) / 500, 52.3 + (i % 40) / 500] },
    properties: {
      roadNumbers: [i % 3 === 0 ? "A10" : i % 3 === 1 ? "A4" : "N200"],
      delayInSeconds: (i % 7) * 60,
      magnitudeOfDelay: ["minor", "moderate", "major"][i % 3],
    },
  })),
});

const store = (data: unknown) => storeDataset(data, { tool: "tomtom-get-traffic", params: {} });

describe("analyseDatasetsHandler", { timeout: 30_000 }, () => {
  beforeEach(() => clearDatasetStore());

  it("answers a question the trimmed response could not", async () => {
    // 3000 incidents: capTrafficIncidents would have shown the agent 100, so any
    // per-road count derived from the response would be wrong. This is the case
    // the whole dataset track exists for.
    const dataset = store(incidents(3000));

    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: `
        const counts = {};
        for (const f of features) {
          for (const road of f.properties.roadNumbers ?? []) {
            counts[road] = (counts[road] ?? 0) + 1;
          }
        }
        return counts;`,
    });

    expect(result.isError).toBeUndefined();
    const body = parse(result);
    expect(body.analysis.A10 + body.analysis.A4 + body.analysis.N200).toBe(3000);
    expect(body.analysed.totalFeatures).toBe(3000);
  });

  it("reports which datasets it ran over", async () => {
    const a = store(incidents(10));
    const b = store(incidents(5));

    const body = parse(
      await analyseDatasetsHandler({
        dataset_ids: [a.id, b.id],
        code: "return { perDataset: Object.fromEntries(Object.entries(byDataset).map(([k, v]) => [k, v.length])) };",
      })
    );

    expect(body.analysed.totalFeatures).toBe(15);
    expect(body.analysed.datasets).toHaveLength(2);
    expect(body.analysed.datasets[0].producedBy).toBe("tomtom-get-traffic");
    expect(body.analysis.perDataset[a.id]).toBe(10);
  });

  it("builds features and byDataset from the same feature objects as datasets", async () => {
    const a = store(incidents(3));
    const b = store(incidents(2));

    const body = parse(
      await analyseDatasetsHandler({
        dataset_ids: [a.id, b.id],
        code: `return [
          features.length,
          features[0] === datasets["${a.id}"].features[0],
          features[3] === byDataset["${b.id}"][0],
          byDataset["${a.id}"] === datasets["${a.id}"].features,
        ];`,
      })
    );

    expect(body.analysis).toEqual([5, true, true, true]);
  });

  it("exposes turf for spatial work", async () => {
    const dataset = store(incidents(200));
    const body = parse(
      await analyseDatasetsHandler({
        dataset_ids: [dataset.id],
        code: `
          const centre = turf.point([4.85, 52.35]);
          const near = features.filter(
            (f) => turf.distance(centre, f, { units: "kilometers" }) < 3
          );
          return { near: near.length, total: features.length };`,
      })
    );
    expect(body.analysis.total).toBe(200);
    expect(body.analysis.near).toBeGreaterThan(0);
    expect(body.analysis.near).toBeLessThan(200);
  });

  it("exposes h3 for hex binning", async () => {
    const dataset = store(incidents(300));
    const body = parse(
      await analyseDatasetsHandler({
        dataset_ids: [dataset.id],
        code: `
          const bins = {};
          for (const f of features) {
            const [lng, lat] = f.geometry.coordinates;
            const cell = h3.latLngToCell(lat, lng, 7);
            bins[cell] = (bins[cell] ?? 0) + 1;
          }
          return { cells: Object.keys(bins).length };`,
      })
    );
    expect(body.analysis.cells).toBeGreaterThan(1);
  });

  it("accepts a Chart.js config when outputFormat is chart", async () => {
    const dataset = store(incidents(50));
    const body = parse(
      await analyseDatasetsHandler({
        dataset_ids: [dataset.id],
        outputFormat: "chart",
        code: `
          const counts = {};
          for (const f of features) counts[f.properties.magnitudeOfDelay] = (counts[f.properties.magnitudeOfDelay] ?? 0) + 1;
          return { type: "bar", data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts) }] } };`,
      })
    );
    expect(body.outputFormat).toBe("chart");
    expect(body.analysis.type).toBe("bar");
  });

  it("rejects a non-chart return when chart was requested", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      outputFormat: "chart",
      code: "return { count: features.length };",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("ChartConfiguration");
  });

  it("names the originating call when an expired dataset's provenance is known", async () => {
    const dataset = store(incidents(2));
    // Past the payload's lifetime but within the provenance index's, which outlives it.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + (DATASET_TTL_SECONDS + 1) * 1000);

    const result = await analyseDatasetsHandler({ dataset_ids: [dataset.id], code: "return 1;" });
    vi.mocked(Date.now).mockRestore();
    expect(result.isError).toBe(true);
    const { error, details } = parse(result);
    expect(details).toMatchObject({
      dataset_id: dataset.id,
      producedBy: { tool: "tomtom-get-traffic" },
    });
    expect(error).toContain("expired");
    // Warns that a refetch may not be equivalent — replay is deliberately not
    // automatic for time-varying data.
    expect(error).toContain("may differ");
  });

  it("fails before running any code when a dataset is missing", async () => {
    const result = await analyseDatasetsHandler({
      dataset_ids: ["ds_nope"],
      code: "return 1;",
    });
    expect(result.isError).toBe(true);
    const { error, details } = parse(result);
    expect(details).toMatchObject({ dataset_id: "ds_nope" });
    expect(error).toContain("not available");
  });

  it("cannot reach another principal's dataset", async () => {
    // Owner scoping is enforced in the store; this asserts analyse-datasets inherits
    // it rather than reading around it.
    const dataset = store(incidents(5));
    mockApiKey.mockReturnValue("key-someone-else");

    const result = await analyseDatasetsHandler({ dataset_ids: [dataset.id], code: "return 1;" });
    mockApiKey.mockReturnValue("key-test");
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("not available");
  });

  it("surfaces a code error with an actionable hint", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: "return features.reduce((acc, f) => { acc[f.properties.nope.deep] = 1; }, {});",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("Hint:");
  });

  it("rejects code that returns nothing", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: "const x = features.length;",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("must return a value");
  });

  it("does not let the analysis mutate the stored dataset", async () => {
    const dataset = store(incidents(3));
    await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: "features[0].properties.roadNumbers = ['HACKED']; return 1;",
    });

    expect(getDataset(dataset.id)?.features[0].properties?.roadNumbers).toEqual(["A10"]);
  });
});

describe("analyseDatasetsHandler with helpers", { timeout: 30_000 }, () => {
  beforeEach(() => clearDatasetStore());

  it("has the place helpers in scope", async () => {
    const dataset = storeDataset(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [5, 52] },
            properties: {
              chargingPark: { connectors: [{ connector: { ratedPowerKW: 22 }, count: 4 }] },
            },
          },
        ],
      },
      { tool: "tomtom-discover-places", params: {} }
    );
    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: "return features.reduce((sum, f) => sum + place.connectors(f).reduce((s, c) => s + c.ratedPowerKW * c.count, 0), 0);",
    });
    expect(parse(result).analysis).toBe(88);
  });

  it("returns a result that looks wrong as an error, with the result beside it", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDatasetsHandler({
      dataset_ids: [dataset.id],
      code: "const byType = {}; for (const f of features) byType[f.properties.nope] = 1; return byType;",
    });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ details: { analysis: { undefined: 1 } } });
    expect(parse(result).error).toContain("property path");
  });
});
