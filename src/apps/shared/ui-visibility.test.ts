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
import { shouldShowUI } from "./ui-visibility";

describe("shouldShowUI", () => {
  it("reads show_ui from the tool result, not from a _meta in the response text", () => {
    const text = { results: [], _meta: { show_ui: true } };

    expect(shouldShowUI({ content: [{ text }], _meta: { show_ui: false } })).toBe(false);
    expect(shouldShowUI({ _meta: { show_ui: true } })).toBe(true);
    expect(shouldShowUI(text)).toBe(true);
    expect(shouldShowUI({})).toBe(true);
    expect(shouldShowUI(null)).toBe(true);
    expect(shouldShowUI({ _meta: { show_ui: "yes" } })).toBe(true);
  });
});
