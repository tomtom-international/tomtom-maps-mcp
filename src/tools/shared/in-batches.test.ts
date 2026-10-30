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
import { dedupeBy, queryAreas } from "./in-batches";

/** A task that records how many calls are in flight, settling in reverse input order. */
const tracked = (fails: (area: number) => boolean = () => false) => {
  let inFlight = 0;
  let peak = 0;
  const task = async (area: number): Promise<string> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20 - area));
    inFlight -= 1;
    if (fails(area)) throw new Error(`area ${area} failed`);
    return `area ${area}`;
  };
  return { task, peak: () => peak };
};

describe("queryAreas", () => {
  const areas = Array.from({ length: 14 }, (_, index) => index);

  it("keeps at most six requests in flight", async () => {
    const { task, peak } = tracked();
    await queryAreas(areas, task);
    expect(peak()).toBe(6);
  });

  it("returns the answers in input order, whatever order they settle in", async () => {
    const { task } = tracked();
    const { succeeded } = await queryAreas(areas, task);
    expect(succeeded).toEqual(areas.map((area) => `area ${area}`));
  });

  it("counts the areas that failed and returns the rest, in order", async () => {
    const { task } = tracked((area) => area % 5 === 0);
    const { succeeded, failed } = await queryAreas(areas, task);
    expect(failed).toBe(3);
    expect(succeeded).toEqual(areas.filter((area) => area % 5 !== 0).map((area) => `area ${area}`));
  });

  it("rethrows when every area fails", async () => {
    const { task } = tracked(() => true);
    await expect(queryAreas(areas, task)).rejects.toThrow("area 0 failed");
  });
});

describe("dedupeBy", () => {
  it("keeps the first item per key, in order, and counts the rest", () => {
    expect(dedupeBy(["a1", "b1", "a2", "c1", "b2"], (item) => item[0])).toEqual({
      unique: ["a1", "b1", "c1"],
      duplicates: 2,
    });
  });
});
