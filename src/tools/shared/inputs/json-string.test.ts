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
import { z } from "zod";
import { orJsonString } from "./json-string";

const checkpoints = orJsonString(z.array(z.object({ afterMinutes: z.number() })));

describe("orJsonString", () => {
  it("takes an array sent as a JSON string, or as JSON-encoded items", () => {
    expect(checkpoints.parse('[{"afterMinutes":30}]')).toEqual([{ afterMinutes: 30 }]);
    expect(checkpoints.parse(['{"afterMinutes":30}', { afterMinutes: 60 }])).toEqual([
      { afterMinutes: 30 },
      { afterMinutes: 60 },
    ]);
  });

  it("leaves a value its schema accepts as it is", () => {
    expect(orJsonString(z.string()).parse('{"type":"Point"}')).toBe('{"type":"Point"}');
    expect(orJsonString(z.array(z.string())).parse(["[1]"])).toEqual(["[1]"]);
    expect(orJsonString(z.boolean().optional()).parse(undefined)).toBeUndefined();
  });

  it("rejects a string that is not JSON of what the schema takes", () => {
    expect(checkpoints.safeParse("thirty minutes").success).toBe(false);
    expect(checkpoints.safeParse(['{"afterHours":1}']).success).toBe(false);
  });

  it("advertises the schema it wraps", () => {
    expect(z.toJSONSchema(checkpoints, { io: "input" })).toEqual(
      z.toJSONSchema(z.array(z.object({ afterMinutes: z.number() })), { io: "input" })
    );
  });
});
