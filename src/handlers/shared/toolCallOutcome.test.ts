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
import { recordOutcome, withRecordedOutcome } from "./toolCallOutcome";

describe("recordOutcome", () => {
  it("does nothing outside a tool call, as when a test runs a handler directly", async () => {
    recordOutcome({ outcome: "retired" });

    const { outcome } = await withRecordedOutcome(async () => "ran");

    expect(outcome).toBeUndefined();
  });

  it("keeps one tool call's outcome apart from another running at the same time", async () => {
    const [first, second] = await Promise.all([
      withRecordedOutcome(async () => {
        await Promise.resolve();
        recordOutcome({ outcome: "retired" });
      }),
      withRecordedOutcome(async () => recordOutcome({ outcome: "ok" })),
    ]);

    expect([first.outcome, second.outcome]).toEqual([{ outcome: "retired" }, { outcome: "ok" }]);
  });
});
