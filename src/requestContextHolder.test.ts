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
import { adoptRequestId, RequestContextHolder } from "./requestContextHolder";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("adoptRequestId", () => {
  it("keeps a caller's id of 8 to 64 letters, digits or dashes", () => {
    expect(adoptRequestId("frontend-1234")).toBe("frontend-1234");
    expect(adoptRequestId("a".repeat(8))).toBe("a".repeat(8));
    expect(adoptRequestId(`${"A1-".repeat(21)}z`)).toBe(`${"A1-".repeat(21)}z`);
  });

  it("mints a fresh id for a missing, short, long or unsafe one", () => {
    for (const header of [undefined, "", "short", "x".repeat(65), "has space!", "line\nbreak1"]) {
      expect(adoptRequestId(header)).toMatch(UUID);
    }
  });
});

describe("RequestContextHolder.current", () => {
  it("is the context of the request running", async () => {
    const context = { requestId: "request-1", session: "session-1" };

    const seen = await RequestContextHolder.run(context, async () => {
      await Promise.resolve();
      return RequestContextHolder.current();
    });

    expect(seen).toEqual(context);
  });

  it("is absent outside a request", () => {
    expect(RequestContextHolder.current()).toBeUndefined();
  });

  it("names the request's client on every line logged after it is known", async () => {
    const seen = await RequestContextHolder.run({ requestId: "request-1" }, async () => {
      RequestContextHolder.nameClient("claude-ai");
      await Promise.resolve();
      return RequestContextHolder.current();
    });

    expect(seen).toEqual({ requestId: "request-1", client: "claude-ai" });
  });

  it("names the stdio client outside a request, once it initializes", () => {
    RequestContextHolder.nameClient("claude-code");

    expect(RequestContextHolder.current()).toEqual({ client: "claude-code" });
  });
});
