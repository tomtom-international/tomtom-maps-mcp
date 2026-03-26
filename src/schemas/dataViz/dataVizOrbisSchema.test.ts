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

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tomtomDataVizSchema } from "./dataVizOrbisSchema";

const schema = z.object(tomtomDataVizSchema);

describe("tomtomDataVizSchema", () => {
  const validBase = {
    layers: [{ type: "markers" }],
    geojson: '{"type":"FeatureCollection","features":[]}',
  };

  it("should accept valid input with inline geojson", () => {
    const result = schema.parse(validBase);
    expect(result.layers).toHaveLength(1);
    expect(result.geojson).toBeDefined();
  });

  it("should accept valid input with data_url", () => {
    const result = schema.parse({
      layers: [{ type: "markers" }],
      data_url: "https://example.com/data.geojson",
    });
    expect(result.data_url).toBe("https://example.com/data.geojson");
  });

  it("should reject invalid data_url format", () => {
    expect(() =>
      schema.parse({ layers: [{ type: "markers" }], data_url: "not-a-url" })
    ).toThrow();
  });

  // Layer type validation
  it.each(["markers", "heatmap", "clusters", "line", "fill", "choropleth"])(
    "should accept layer type: %s",
    (type) => {
      expect(() => schema.parse({ ...validBase, layers: [{ type }] })).not.toThrow();
    }
  );

  it("should reject invalid layer type", () => {
    expect(() =>
      schema.parse({ ...validBase, layers: [{ type: "invalid" }] })
    ).toThrow();
  });

  // Layer count validation
  it("should require at least 1 layer", () => {
    expect(() => schema.parse({ ...validBase, layers: [] })).toThrow();
  });

  it("should accept up to 10 layers", () => {
    const layers = Array.from({ length: 10 }, () => ({ type: "markers" }));
    expect(() => schema.parse({ ...validBase, layers })).not.toThrow();
  });

  it("should reject more than 10 layers", () => {
    const layers = Array.from({ length: 11 }, () => ({ type: "markers" }));
    expect(() => schema.parse({ ...validBase, layers })).toThrow();
  });

  // fill_opacity validation
  it("should accept fill_opacity between 0 and 1", () => {
    const result = schema.parse({
      ...validBase,
      layers: [{ type: "fill", fill_opacity: 0.5 }],
    });
    expect(result.layers[0].fill_opacity).toBe(0.5);
  });

  it("should reject fill_opacity below 0", () => {
    expect(() =>
      schema.parse({ ...validBase, layers: [{ type: "fill", fill_opacity: -0.1 }] })
    ).toThrow();
  });

  it("should reject fill_opacity above 1", () => {
    expect(() =>
      schema.parse({ ...validBase, layers: [{ type: "fill", fill_opacity: 1.1 }] })
    ).toThrow();
  });

  // color_scale validation
  it("should accept color_scale with exactly 2 items", () => {
    const result = schema.parse({
      ...validBase,
      layers: [{ type: "markers", color_scale: ["#000000", "#ffffff"] }],
    });
    expect(result.layers[0].color_scale).toHaveLength(2);
  });

  it("should reject color_scale with fewer than 2 items", () => {
    expect(() =>
      schema.parse({ ...validBase, layers: [{ type: "markers", color_scale: ["#000000"] }] })
    ).toThrow();
  });

  it("should reject color_scale with more than 2 items", () => {
    expect(() =>
      schema.parse({
        ...validBase,
        layers: [{ type: "markers", color_scale: ["#000", "#fff", "#aaa"] }],
      })
    ).toThrow();
  });

  // Optional fields
  it("should accept all optional fields", () => {
    const result = schema.parse({
      ...validBase,
      title: "Test Map",
      layers: [
        {
          type: "choropleth",
          color_property: "population",
          color_scale: ["#2196F3", "#F44336"],
          size_property: "magnitude",
          label_property: "name",
          popup_fields: ["name", "address"],
          fill_opacity: 0.7,
          filter_property: "type",
          filter_values: ["restaurant", "cafe"],
        },
      ],
    });
    expect(result.title).toBe("Test Map");
    expect(result.layers[0].color_property).toBe("population");
    expect(result.layers[0].popup_fields).toEqual(["name", "address"]);
  });
});
