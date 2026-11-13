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
import { adoptTrackingId, RequestContextHolder } from "./requestContextHolder";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("adoptTrackingId", () => {
  it("keeps the gateway's Tracking-Id, a UUID it logs on the request's own row", () => {
    expect(adoptTrackingId("c65832be-3d4f-9840-b09f-8987713eb109")).toBe(
      "c65832be-3d4f-9840-b09f-8987713eb109"
    );
    expect(adoptTrackingId("0B7E3F52-6A1D-4C9E-9F3A-2D5B8C7E1A40")).toBe(
      "0B7E3F52-6A1D-4C9E-9F3A-2D5B8C7E1A40"
    );
  });

  it("mints a fresh UUID for a missing id or one the gateway would replace", () => {
    for (const header of [undefined, "", "frontend-1234", "has space!", "line\nbreak1"]) {
      expect(adoptTrackingId(header)).toMatch(UUID);
    }
  });
});

describe("RequestContextHolder.current", () => {
  it("is the context of the request running", async () => {
    const context = { trackingId: "request-1", session: "session-1" };

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
    const seen = await RequestContextHolder.run({ trackingId: "request-1" }, async () => {
      RequestContextHolder.nameClient("claude-ai");
      await Promise.resolve();
      return RequestContextHolder.current();
    });

    expect(seen).toEqual({ trackingId: "request-1", client: "claude-ai" });
  });

  it("names the stdio client outside a request, once it initializes", () => {
    RequestContextHolder.nameClient("claude-code");

    expect(RequestContextHolder.current()).toEqual({ client: "claude-code" });
  });
});
