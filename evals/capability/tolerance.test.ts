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
import { DEMANDING_TASKS } from "./tasks-demanding";
import { formatTolerance, measured } from "./tolerance";

describe("formatTolerance", () => {
  it("writes each kind of margin as the rubrics do", () => {
    expect(formatTolerance({ absolute: 2 })).toBe("±2");
    expect(formatTolerance({ absolute: 0.2, unit: "km" })).toBe("±0.2 km");
    expect(formatTolerance({ relative: 0.15 })).toBe("±15%");
    expect(formatTolerance({ points: 4 })).toBe("±4 percentage points");
    expect(formatTolerance({ relative: 0.25, absolute: 3, below: 12 })).toBe(
      "±25% (±3 when the reference is under 12)"
    );
    expect(formatTolerance({ relative: 0.15, absolute: 0.3, below: 2, unit: "km" })).toBe(
      "±15% (±0.3 km when the reference is under 2 km)"
    );
  });
});

describe("measured", () => {
  it("renders the rubric from the margins it keeps", () => {
    const task = measured(
      { count: { absolute: 2 }, distance: { absolute: 30, unit: "m" } },
      (within) => `A count within ${within.count} and a distance within ${within.distance}.`
    );
    expect(task.rubric).toBe("A count within ±2 and a distance within ±30 m.");
    expect(task.tolerance.distance).toEqual({ absolute: 30, unit: "m" });
  });
});

describe("the demanding corpus", () => {
  it("has unique task ids", () => {
    const ids = DEMANDING_TASKS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(DEMANDING_TASKS.map((task) => [task.id, task] as const))(
    "%s states every margin it allows in its rubric",
    (_, { rubric, tolerance }) => {
      for (const margin of Object.values(tolerance))
        expect(rubric).toContain(formatTolerance(margin));
    }
  );
});
