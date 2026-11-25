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
import { locationInputSchema } from "./locationInput";

describe("locationInputSchema", () => {
  it("takes a location sent as a JSON string", () => {
    expect(locationInputSchema.parse('{"position":[4.47,51.92]}')).toEqual({
      position: [4.47, 51.92],
    });
    expect(locationInputSchema.parse('{"query":"Rotterdam"}')).toEqual({ query: "Rotterdam" });
  });

  it("keeps the position of a location sent with a query too, which would be geocoded again", () => {
    expect(locationInputSchema.parse({ query: "Rijksmuseum", position: [4.885, 52.36] })).toEqual({
      position: [4.885, 52.36],
    });
    expect(locationInputSchema.parse({ query: "Rijksmuseum" })).toEqual({ query: "Rijksmuseum" });
  });

  it("names both shapes when an input is neither", () => {
    for (const input of ["Rotterdam", { name: "Rotterdam" }]) {
      expect(locationInputSchema.safeParse(input).error?.issues[0].message).toBe(
        "A location is an object: { query }, { position: [longitude, latitude] } or " +
          "{ dataset_id, featureIndex? }."
      );
    }
  });
});
