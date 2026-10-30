/*
 * Copyright (C) 2026 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import { inputBounds } from "./framing";

describe("inputBounds", () => {
  const boundingBox = [4.8, 52.3, 5.0, 52.4];

  it("frames a lone boundingBox from the input", () => {
    expect(inputBounds({ mode: "within", boundingBox })).toEqual(boundingBox);
  });

  it("leaves a boundingBox with queries to the result, which covers both", () => {
    expect(inputBounds({ mode: "within", boundingBox, queries: ["Utrecht"] })).toBeUndefined();
  });

  it("leaves a nearby scope to the result, which resolves it", () => {
    expect(inputBounds({ mode: "nearby", position: [4.9, 52.37] })).toBeUndefined();
  });

  it("frames nothing without a where", () => {
    expect(inputBounds(undefined)).toBeUndefined();
  });
});
