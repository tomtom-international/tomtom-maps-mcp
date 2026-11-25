/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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
import { z } from "zod";
import { tomtomPlanRouteSchema } from "./planRouteSchema";

describe("tomtomPlanRouteSchema checkpoints", () => {
  const schema = z.object(tomtomPlanRouteSchema);
  const locations = [{ position: [4.9, 52.37] }, { position: [5.12, 52.09] }];
  const parse = (checkpoints: unknown) => schema.safeParse({ locations, checkpoints });

  it("takes a checkpoint by driving time or by distance", () => {
    const parsed = parse([{ afterMinutes: 60 }, { afterKilometers: 100 }]);
    expect(parsed.success && parsed.data.checkpoints).toEqual([
      { afterMinutes: 60 },
      { afterKilometers: 100 },
    ]);
  });

  it("rejects a checkpoint with both, rather than dropping one", () => {
    expect(parse([{ afterMinutes: 60, afterKilometers: 100 }]).success).toBe(false);
  });

  it("rejects a checkpoint with neither", () => {
    expect(parse([{ afterHours: 2 }]).success).toBe(false);
  });
});
