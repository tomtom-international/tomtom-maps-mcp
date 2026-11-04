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
import type { DatasetTool } from "../../services/datasets/dataset-store";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockApiKey = vi.fn(() => "key-test");
vi.mock("../../services/base/tomtomClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/base/tomtomClient")>()),
  getEffectiveApiKey: () => mockApiKey(),
}));

const { deriveDatasetsHandler } = await import("./derive-datasets");
const { analyseDatasetsHandler } = await import("./analyse-datasets");
const { describeDatasetHandler } = await import("./describe-dataset");
const { resolveWithin } = await import("../shared/inputs/resolve-where");
const { clearDatasetStore, getDataset, storeDataset } = await import(
  "../../services/datasets/dataset-store"
);

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const chargers = storeDatasetOf("tomtom-discover-places", [
  { coordinates: [4.9, 52.37], properties: { poi: { name: "Fast A" }, maxPowerKW: 150 } },
  { coordinates: [4.91, 52.38], properties: { poi: { name: "Slow B" }, maxPowerKW: 11 } },
  { coordinates: [4.92, 52.36], properties: { poi: { name: "Fast C" }, maxPowerKW: 300 } },
]);

function storeDatasetOf(
  tool: DatasetTool,
  points: { coordinates: number[]; properties: Record<string, unknown> }[]
) {
  return () =>
    storeDataset(
      {
        type: "FeatureCollection",
        features: points.map(({ coordinates, properties }) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties,
        })),
      },
      { tool, params: {} }
    );
}

const derive = async (dataset_ids: string[], code: string, description = "test") =>
  parse(await deriveDatasetsHandler({ dataset_ids, code, description }));

describe("deriveDatasetsHandler", { timeout: 30_000 }, () => {
  beforeEach(() => clearDatasetStore());

  it("stores what the code returns and says what it holds", async () => {
    const source = chargers();

    const body = await derive(
      [source.id],
      "return features.filter((f) => f.properties.maxPowerKW >= 150);",
      "fast chargers"
    );

    expect(body).toMatchObject({
      count: 2,
      geometryTypes: ["Point"],
      description: "fast chargers",
      derivedFrom: [source.id],
    });
    expect(body.properties["poi.name"].values).toEqual(["Fast A", "Fast C"]);
    expect(getDataset(body.dataset_id)?.provenance).toMatchObject({
      tool: "tomtom-derive-datasets",
      derivedFrom: [source.id],
    });
  });

  it("derives from a derived dataset, and the chain reads back through describe", async () => {
    const source = chargers();
    const fast = await derive(
      [source.id],
      "return features.filter((f) => f.properties.maxPowerKW >= 150);"
    );
    const zones = await derive(
      [fast.dataset_id],
      "return features.map((f) => turf.buffer(f, 500, { units: 'meters' }));",
      "500 m around each fast charger"
    );

    expect(zones).toMatchObject({ count: 2, geometryTypes: ["Polygon"] });
    expect(zones.properties["poi.name"].values).toEqual(["Fast A", "Fast C"]);
    const described = parse(await describeDatasetHandler({ dataset_id: zones.dataset_id }));
    expect(described).toMatchObject({
      producedBy: "tomtom-derive-datasets",
      description: "500 m around each fast charger",
      derivedFrom: [fast.dataset_id],
    });
  });

  it("gives a search the derived polygons to search within", async () => {
    const source = chargers();
    const zones = await derive(
      [source.id],
      "return features.map((f) => turf.buffer(f, 500, { units: 'meters' }));"
    );

    const areas = await resolveWithin({ mode: "within", dataset_ids: [zones.dataset_id] });

    expect(areas).toHaveLength(3);
    expect(areas.every((area) => area.source === "dataset")).toBe(true);
  });

  it("joins two datasets into rows without a place", async () => {
    const source = chargers();
    const other = chargers();

    const body = await derive(
      [source.id, other.id],
      `return byDataset[${JSON.stringify(source.id)}].map((f, i) => ({
        type: "Feature",
        geometry: null,
        properties: { name: f.properties.poi.name, twin: byDataset[${JSON.stringify(other.id)}][i].properties.poi.name },
      }));`
    );

    expect(body).toMatchObject({ count: 3, geometryTypes: [] });
    const analysed = parse(
      await analyseDatasetsHandler({
        dataset_ids: [body.dataset_id],
        code: "return features.filter((f) => f.properties.name === f.properties.twin).length;",
      })
    );
    expect(analysed.analysis).toBe(3);
  });

  it("refuses an empty result and keeps nothing", async () => {
    const source = chargers();

    const result = await deriveDatasetsHandler({
      dataset_ids: [source.id],
      code: "return features.filter(() => false);",
      description: "nothing",
    });

    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("no features");
  });

  it("refuses a value that is not GeoJSON", async () => {
    const source = chargers();

    const result = await deriveDatasetsHandler({
      dataset_ids: [source.id],
      code: "return { count: features.length };",
      description: "not geojson",
    });

    expect(result.isError).toBe(true);
  });

  it("returns properties that look wrong as an error, with a sample beside it", async () => {
    const source = chargers();

    const result = await deriveDatasetsHandler({
      dataset_ids: [source.id],
      code: "return features.map((f) => ({ ...f, properties: { label: String(f.properties.poi) } }));",
      description: "wrong path",
    });

    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ details: { features: 3 } });
    expect(parse(result).error).toContain("property path");
  });

  it("cannot derive from another principal's dataset", async () => {
    const source = chargers();
    mockApiKey.mockReturnValue("key-someone-else");

    const result = await deriveDatasetsHandler({
      dataset_ids: [source.id],
      code: "return features;",
      description: "theft",
    });
    mockApiKey.mockReturnValue("key-test");

    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("not available");
  });

  it("does not let the code change its source", async () => {
    const source = chargers();

    await derive([source.id], "features[0].properties.maxPowerKW = 0; return features;");

    expect(getDataset(source.id)?.features[0].properties?.maxPowerKW).toBe(150);
  });
});
