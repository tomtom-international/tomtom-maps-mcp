/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import { inputBounds, resultBounds, boundsWithoutAppData } from "./framing";

describe("inputBounds", () => {
  const boundingBox = [4.8, 52.3, 5.0, 52.4];

  it("frames a lone boundingBox from the input", () => {
    expect(inputBounds({ mode: "within", boundingBox })).toEqual(boundingBox);
  });

  it("leaves a boundingBox with queries to the result, which covers both", () => {
    expect(inputBounds({ mode: "within", boundingBox, queries: ["Utrecht"] })).toBeUndefined();
  });

  it("leaves a boundingBox with areas or geometries to the result, which covers them all", () => {
    const area = { name: "Utrecht", boundingBox: [5, 52, 5.2, 52.2] };
    expect(inputBounds({ mode: "within", boundingBox, areas: [area] })).toBeUndefined();
    const triangle = {
      type: "Polygon" as const,
      coordinates: [
        [
          [5, 52],
          [5.2, 52],
          [5.1, 52.2],
          [5, 52],
        ],
      ],
    };
    expect(inputBounds({ mode: "within", boundingBox, geometries: [triangle] })).toBeUndefined();
  });

  it("leaves a nearby scope to the result, which resolves it", () => {
    expect(inputBounds({ mode: "nearby", position: [4.9, 52.37] })).toBeUndefined();
  });

  it("frames nothing without a where", () => {
    expect(inputBounds(undefined)).toBeUndefined();
  });
});

describe("resultBounds", () => {
  it("frames the app data's bounds", () => {
    expect(resultBounds({ bbox: [4.8, 52.3, 5.0, 52.4] })).toEqual([4.8, 52.3, 5.0, 52.4]);
  });

  it("frames a full result, which has no app data, on its incidents", () => {
    const incidentAt = (coordinates: number[]) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates },
      properties: {},
    });
    const full = { features: [incidentAt([4.9, 52.37]), incidentAt([5.1, 52.09])] };
    expect(resultBounds(full)).toEqual([4.9, 52.09, 5.1, 52.37]);
  });

  it("frames nothing without bounds or incidents", () => {
    expect(resultBounds({ features: [] })).toBeUndefined();
  });
});

describe("boundsWithoutAppData", () => {
  const utrecht = [4.970287, 52.026243, 5.195298, 52.142137];
  const textNaming = (...boxes: number[][]) => ({
    incidents: [],
    searched: {
      mode: "within",
      resolvedAreas: boxes.map((boundingBox) => ({
        query: "Utrecht",
        matched: "Utrecht",
        area: { name: "Utrecht", boundingBox },
      })),
    },
    tool: "tomtom-get-traffic",
  });

  it("frames a named area on the bounds the text reports it resolved to", () => {
    expect(
      boundsWithoutAppData({ mode: "within", queries: ["Utrecht"] }, textNaming(utrecht))
    ).toEqual(utrecht);
  });

  it("unions the resolved areas with the boxes, areas and geometries the input gives", () => {
    const where = {
      mode: "within" as const,
      queries: ["Utrecht"],
      boundingBox: [4.8, 52.3, 5.0, 52.4],
      areas: [{ name: "Amersfoort", boundingBox: [5.3, 52.1, 5.5, 52.2] }],
      geometries: [
        {
          type: "Polygon" as const,
          coordinates: [
            [
              [5.0, 51.9],
              [5.1, 51.9],
              [5.05, 52.0],
              [5.0, 51.9],
            ],
          ],
        },
      ],
    };
    expect(boundsWithoutAppData(where, textNaming(utrecht))).toEqual([4.8, 51.9, 5.5, 52.4]);
  });

  it("frames nothing when the text lacks the areas the queries resolved to", () => {
    const where = { mode: "within" as const, queries: ["Utrecht"], boundingBox: utrecht };
    expect(boundsWithoutAppData(where, { incidents: [] })).toBeUndefined();
    expect(boundsWithoutAppData(where, textNaming([5, 52]))).toBeUndefined();
  });

  it("frames a nearby or alongRoute scope on the bounds its text gives", () => {
    const where = { mode: "nearby" as const, query: "Schiphol" };
    expect(boundsWithoutAppData(where, { incidents: [], bbox: utrecht })).toEqual(utrecht);
    expect(boundsWithoutAppData(where, { incidents: [] })).toBeUndefined();
    expect(boundsWithoutAppData(undefined, textNaming(utrecht))).toBeUndefined();
  });
});
