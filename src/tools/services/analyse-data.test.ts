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

vi.mock("../../services/api-key", () => ({ getEffectiveApiKey: () => "key-test" }));

const { analyseDataHandler } = await import("./analyse-data");
const { clearDatasetStore, storeDataset } = await import("../../services/datasets/dataset-store");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** A traffic-shaped dataset — the case a trimmed response actively breaks. */
const incidents = (count: number) => ({
  incidents: Array.from({ length: count }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.8 + (i % 50) / 500, 52.3 + (i % 40) / 500] },
    properties: {
      roadNumbers: [i % 3 === 0 ? "A10" : i % 3 === 1 ? "A4" : "N200"],
      delay: (i % 7) * 60,
      magnitudeOfDelay: i % 5,
    },
  })),
});

const store = (data: unknown, kind: "incidents" | "places" = "incidents") =>
  storeDataset({ data, kind, provenance: { tool: "tomtom-traffic", params: {} } });

describe("analyseDataHandler", { timeout: 30_000 }, () => {
  beforeEach(() => clearDatasetStore());

  it("answers a question the trimmed response could not", async () => {
    // 3000 incidents: capTrafficIncidents would have shown the agent 100, so any
    // per-road count derived from the response would be wrong. This is the case
    // the whole dataset track exists for.
    const dataset = store(incidents(3000));

    const result = await analyseDataHandler({
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
      await analyseDataHandler({
        dataset_ids: [a.id, b.id],
        code: "return { perDataset: Object.fromEntries(Object.entries(byDataset).map(([k, v]) => [k, v.length])) };",
      })
    );

    expect(body.analysed.totalFeatures).toBe(15);
    expect(body.analysed.datasets).toHaveLength(2);
    expect(body.analysed.datasets[0].producedBy).toBe("tomtom-traffic");
    expect(body.analysis.perDataset[a.id]).toBe(10);
  });

  it("exposes turf for spatial work", async () => {
    const dataset = store(incidents(200));
    const body = parse(
      await analyseDataHandler({
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
      await analyseDataHandler({
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
      await analyseDataHandler({
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
    const result = await analyseDataHandler({
      dataset_ids: [dataset.id],
      outputFormat: "chart",
      code: "return { count: features.length };",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("ChartConfiguration");
  });

  it("names the originating call when an expired dataset's provenance is known", async () => {
    const dataset = store(incidents(2));
    const { deleteDataset } = await import("../../services/datasets/dataset-store");
    // Delete the payload but leave the provenance index — exactly what expiry
    // looks like, since provenance outlives the data.
    deleteDataset(dataset.id);

    const result = await analyseDataHandler({ dataset_ids: [dataset.id], code: "return 1;" });
    expect(result.isError).toBe(true);
    const { error } = parse(result);
    expect(error).toContain("tomtom-traffic");
    expect(error).toContain("expired");
    // Warns that a refetch may not be equivalent — replay is deliberately not
    // automatic for time-varying data.
    expect(error).toContain("may differ");
  });

  it("fails before running any code when a dataset is missing", async () => {
    const result = await analyseDataHandler({
      dataset_ids: ["ds_nope"],
      code: "return 1;",
    });
    expect(result.isError).toBe(true);
    const { error } = parse(result);
    expect(error).toContain("ds_nope");
    expect(error).toContain("not available");
  });

  it("cannot reach another principal's dataset", async () => {
    // Owner scoping is enforced in the store; this asserts analyse-data inherits
    // it rather than reading around it.
    const dataset = store(incidents(5));
    const { getDataset } = await import("../../services/datasets/dataset-store");
    vi.spyOn({ getDataset }, "getDataset");

    const apiKey = await import("../../services/api-key");
    vi.spyOn(apiKey, "getEffectiveApiKey").mockReturnValue("key-someone-else");

    const result = await analyseDataHandler({ dataset_ids: [dataset.id], code: "return 1;" });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("not available");

    vi.mocked(apiKey.getEffectiveApiKey).mockReturnValue("key-test");
  });

  it("surfaces a code error with an actionable hint", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDataHandler({
      dataset_ids: [dataset.id],
      code: "return features.reduce((acc, f) => { acc[f.properties.nope.deep] = 1; }, {});",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("Hint:");
  });

  it("rejects code that returns nothing", async () => {
    const dataset = store(incidents(5));
    const result = await analyseDataHandler({
      dataset_ids: [dataset.id],
      code: "const x = features.length;",
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("must return a value");
  });

  it("does not let the analysis mutate the stored dataset", async () => {
    const dataset = store(incidents(3));
    await analyseDataHandler({
      dataset_ids: [dataset.id],
      code: "features[0].properties.roadNumbers = ['HACKED']; return 1;",
    });

    const { getDataset } = await import("../../services/datasets/dataset-store");
    const after = getDataset(dataset.id);
    expect(after).toBeDefined();
    const held = (
      after?.data as { incidents: { properties: { roadNumbers: string[] } }[] } | undefined
    )?.incidents;
    expect(held?.[0].properties.roadNumbers).toEqual(["A10"]);
  });
});
