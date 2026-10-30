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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordFetch } from "../../../services/shared/recordFetch";
import { loadFixture } from "../__fixtures__";
import { resolvePoiCategories } from "./resolve-poi-categories";

vi.mock("../../../services/api-key", () => ({ requireApiKey: () => "offline-test-key" }));

// The maps-sdk caches the category list per language, so one stub serves every test.
describe("resolvePoiCategories on the recorded category list", () => {
  beforeAll(() => {
    recordFetch(loadFixture("poi-categories"));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["italian food", "ITALIAN_RESTAURANT"],
    ["sushi", "SUSHI_RESTAURANT"],
    ["gym", "FITNESS_CLUB_AND_CENTER"],
    ["ev charging", "CHARGING_LOCATION"],
  ])("resolves %s to %s", async (words, code) => {
    const { resolved, unresolved } = await resolvePoiCategories([words]);

    expect(resolved).toContain(code);
    expect(unresolved).toEqual([]);
  });

  it("keeps a code as given and reports a word that matches nothing", async () => {
    expect(await resolvePoiCategories(["CAFE", "xyzzy"])).toEqual({
      resolved: ["CAFE"],
      unresolved: ["xyzzy"],
    });
  });

  it("takes a word that spells a code as that code, without a lookup", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const before = fetch.mock.calls.length;

    // A language no other test loads, so a lookup could not come from the cache.
    expect(await resolvePoiCategories(["café", "Fuel station"], "de-DE")).toEqual({
      resolved: ["CAFE", "FUEL_STATION"],
      unresolved: [],
    });
    expect(fetch.mock.calls.length).toBe(before);
  });

  it("resolves nothing to no filter, without a lookup", async () => {
    expect(await resolvePoiCategories([])).toEqual({ resolved: undefined, unresolved: [] });
  });
});
