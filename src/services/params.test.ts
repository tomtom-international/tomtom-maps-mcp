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

import { describe, expect, it } from "vitest";
import { compact, nonEmpty } from "./params";

describe("compact", () => {
  it("drops undefined values", () => {
    expect(compact({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("keeps falsy values that are not undefined", () => {
    // These all previously survived the `!== undefined` guards they replace —
    // `radiusMeters: 0` and `typeahead: false` are meaningful params.
    expect(compact({ zero: 0, empty: "", no: false, nil: null, arr: [] })).toEqual({
      zero: 0,
      empty: "",
      no: false,
      nil: null,
      arr: [],
    });
  });

  it("omits the key entirely rather than setting it to undefined", () => {
    expect(Object.keys(compact({ a: undefined, b: 1 }))).toEqual(["b"]);
  });
});

describe("nonEmpty", () => {
  it("returns undefined for undefined and for an empty array", () => {
    expect(nonEmpty(undefined)).toBeUndefined();
    expect(nonEmpty([])).toBeUndefined();
  });

  it("returns the array when it has entries", () => {
    expect(nonEmpty(["NL"])).toEqual(["NL"]);
  });
});
