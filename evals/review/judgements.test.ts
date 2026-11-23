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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  consistency,
  type Judgements,
  majorityVerdict,
  readJudgements,
  type SavedVerdict,
  splitOf,
  writeJudgements,
} from "./judgements";

const verdict = (overrides: Partial<SavedVerdict> = {}): SavedVerdict => ({
  answered: true,
  grounded: true,
  acknowledgedLimit: false,
  madeClaims: true,
  reason: "",
  judgeTokens: 100,
  ...overrides,
});

describe("splitOf", () => {
  it("puts a key on the same side every time, about a third on tuning", () => {
    const keys = Array.from({ length: 300 }, (_, index) => `run/task-${index}`);
    expect(keys.map(splitOf)).toEqual(keys.map(splitOf));
    const tuning = keys.filter((key) => splitOf(key) === "tuning").length;
    expect(tuning).toBeGreaterThan(70);
    expect(tuning).toBeLessThan(130);
  });
});

describe("majorityVerdict", () => {
  it("takes what most repeats said, and the first repeat on a tie", () => {
    expect(
      majorityVerdict([verdict(), verdict({ grounded: false }), verdict({ grounded: false })])
    ).toEqual({ answered: true, grounded: false, madeClaims: true });
    expect(majorityVerdict([verdict({ answered: false }), verdict()])?.answered).toBe(false);
    expect(majorityVerdict([])).toBeUndefined();
  });
});

describe("consistency", () => {
  it("counts the tasks whose repeats all agree, over the tasks repeated", () => {
    expect(
      consistency({
        steady: [verdict(), verdict()],
        wavering: [verdict(), verdict({ grounded: false })],
        once: [verdict()],
      })
    ).toEqual({
      answered: { count: 2, of: 2 },
      grounded: { count: 1, of: 2 },
      madeClaims: { count: 2, of: 2 },
    });
  });
});

describe("writeJudgements and readJudgements", () => {
  it("round-trips, and names the label it cannot find", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eval-judgements-"));
    try {
      const judgements: Judgements = {
        label: "gpt-5.1-abc",
        judgeProvider: "azure",
        judgeModel: "gpt-5.1",
        promptVersion: "abc",
        repeats: 1,
        generatedAt: "2026-11-23T12:00:00Z",
        verdicts: { "run/task": [verdict()] },
        errors: {},
      };
      writeJudgements(judgements, directory);
      expect(readJudgements("gpt-5.1-abc", directory)).toEqual(judgements);
      expect(() => readJudgements("missing", directory)).toThrow(/No judgements labeled "missing"/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
