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

import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../createServer";
import { schemas } from "../schemas";
import { mcpRequestHandler, registeredInputShape } from "./mcpSdkPrivateFields";

describe("registeredInputShape", () => {
  it("is the zod shape a tool was registered with", async () => {
    const server = await createServer();

    expect(Object.keys(registeredInputShape(server, "tomtom-geocode") ?? {})).toEqual(
      Object.keys(schemas.tomtomGeocodeSearchSchema)
    );
  });

  it("is absent for a tool the server does not register", async () => {
    const server = await createServer();

    expect(registeredInputShape(server, "tomtom-teleport")).toBeUndefined();
    expect(registeredInputShape(server, "constructor")).toBeUndefined();
  });
});

describe("mcpRequestHandler", () => {
  it("is the handler the SDK installed for a method", async () => {
    const server = await createServer();

    expect(mcpRequestHandler(server, CallToolRequestSchema.shape.method.value)).toBeTypeOf(
      "function"
    );
  });
});
