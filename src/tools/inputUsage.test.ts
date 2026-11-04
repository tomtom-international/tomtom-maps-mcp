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
import { schemas } from "../schemas";
import { inputUsage, invalidInputs } from "./inputUsage";

const shape = {
  query: z.string(),
  limit: z.number().optional(),
  countrySet: z.string().optional(),
  response_detail: z.enum(["compact", "full", "geometry"]).default("compact"),
  openingHours: z.boolean().optional(),
  connectorTypes: z.array(z.enum(["IEC62196Type2", "Chademo"])).optional(),
  routes: z.array(z.object({ origin: z.array(z.number()), label: z.string() })).optional(),
};

describe("inputUsage", () => {
  it("names the optional inputs the client sent, sorted, and leaves the required ones out", () => {
    const usage = inputUsage(shape, { query: "pizza", limit: 5, countrySet: "NL" });

    expect(usage.optionalInputs).toEqual(["countrySet", "limit"]);
  });

  it("counts a value equal to the default, an empty string and false as sent, but not null", () => {
    const usage = inputUsage(shape, {
      query: "pizza",
      response_detail: "compact",
      countrySet: "",
      openingHours: false,
      limit: null,
    });

    expect(usage.optionalInputs).toEqual(["countrySet", "openingHours", "response_detail"]);
  });

  it("names an object input once, never the keys inside it", () => {
    const usage = inputUsage(shape, {
      query: "pizza",
      routes: [{ origin: [4.9, 52.37], label: "home" }],
    });

    expect(usage.optionalInputs).toEqual(["routes"]);
    expect(usage.unsupportedInputs).toEqual([]);
  });

  it("names inputs the tool does not support, and an unnameable one only as <other>", () => {
    const usage = inputUsage(shape, {
      query: "pizza",
      radius: 500,
      avoidTolls: true,
      "my home address": "Keizersgracht 12",
    });

    expect(usage.unsupportedInputs).toEqual(["<other>", "avoidTolls", "radius"]);
  });

  it("names at most ten unsupported inputs", () => {
    const invented = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`made_up_${index}`, 1])
    );

    expect(inputUsage(shape, { query: "pizza", ...invented }).unsupportedInputs).toHaveLength(10);
  });

  it("records the option chosen for an enum or boolean input, each element of an enum list", () => {
    const usage = inputUsage(shape, {
      query: "pizza",
      response_detail: "geometry",
      openingHours: true,
      connectorTypes: ["IEC62196Type2", "Chademo"],
    });

    expect(usage.chosenInputOptions).toEqual([
      { input: "connectorTypes", option: "Chademo" },
      { input: "connectorTypes", option: "IEC62196Type2" },
      { input: "openingHours", option: "true" },
      { input: "response_detail", option: "geometry" },
    ]);
  });

  it("records no option outside the schema's list, and none of a string or number input", () => {
    const usage = inputUsage(shape, {
      query: "pizza",
      response_detail: "everything",
      connectorTypes: ["Tesla"],
      limit: 5,
      countrySet: "NL",
    });

    expect(usage.chosenInputOptions).toEqual([]);
  });

  it("is empty for arguments that are not an object", () => {
    for (const rawArguments of [undefined, null, "pizza", ["query"]]) {
      expect(inputUsage(shape, rawArguments)).toEqual({
        optionalInputs: [],
        unsupportedInputs: [],
        chosenInputOptions: [],
      });
    }
  });

  it("emits no value a client sent, for any tool's inputs", () => {
    const sentinel = "sentinel-7f3a";
    for (const [name, toolShape] of Object.entries(schemas)) {
      const rawArguments = {
        ...Object.fromEntries(Object.keys(toolShape).map((input) => [input, sentinel])),
        madeUp: sentinel,
      };

      const emitted = JSON.stringify([
        inputUsage(toolShape, rawArguments),
        invalidInputs(toolShape, rawArguments),
      ]);

      expect(emitted, name).not.toContain(sentinel);
    }
  });
});

describe("invalidInputs", () => {
  it("names the inputs that failed validation by their top-level name", () => {
    const rejected = invalidInputs(shape, {
      query: 42,
      connectorTypes: ["IEC62196Type2", "Tesla"],
      routes: [{ origin: "home", label: "x" }],
    });

    expect(rejected).toEqual(["connectorTypes", "query", "routes"]);
  });

  it("is empty for valid arguments, and ignores inputs the schema does not have", () => {
    expect(invalidInputs(shape, { query: "pizza", radius: "far" })).toEqual([]);
  });

  it("names no input when the arguments are not an object at all", () => {
    expect(invalidInputs(shape, "pizza")).toEqual([]);
  });
});
