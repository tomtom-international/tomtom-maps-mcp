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

import { z } from "zod";

export type InputShape = Record<string, z.core.$ZodType>;

export interface ChosenInputOption {
  input: string;
  option: string;
}

export interface InputUsage {
  optionalInputs: string[];
  unsupportedInputs: string[];
  chosenInputOptions: ChosenInputOption[];
}

interface SchemaInputs {
  optional: ReadonlySet<string>;
  allowedOptions: ReadonlyMap<string, ReadonlySet<string>>;
}

const NAMEABLE_INPUT = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const UNNAMEABLE_INPUT = "<other>";
const MAX_UNSUPPORTED_INPUTS = 10;
const BOOLEAN_OPTIONS: ReadonlySet<string> = new Set(["true", "false"]);

export function inputUsage(shape: InputShape, rawArguments: unknown): InputUsage {
  const sent = sentInputs(rawArguments);
  // Required inputs are left out: every call sends them, so tool call counts already show their use
  // Only optional fields are logged for optimizations
  const { optional, allowedOptions } = schemaInputs(shape);
  const optionalInputs = sorted(Object.keys(sent).filter((input) => optional.has(input)));
  const unsupportedInputs = sorted(
    Object.keys(sent)
      .filter((input) => !Object.hasOwn(shape, input))
      .map((input) => (NAMEABLE_INPUT.test(input) ? input : UNNAMEABLE_INPUT))
  ).slice(0, MAX_UNSUPPORTED_INPUTS);
  const chosenInputOptions = optionalInputs.flatMap((input) => {
    const allowed = allowedOptions.get(input);
    if (!allowed) return [];
    const chosen = [sent[input]].flat().map(String);
    return sorted(chosen.filter((option) => allowed.has(option))).map((option) => ({
      input,
      option,
    }));
  });
  return { optionalInputs, unsupportedInputs, chosenInputOptions };
}

export function invalidInputs(shape: InputShape, rawArguments: unknown): string[] {
  const result = z.object(shape).safeParse(rawArguments);
  if (result.success) return [];
  const names = result.error.issues.map((issue) => issue.path[0]);
  return sorted(names.filter((name): name is string => typeof name === "string"));
}

function sentInputs(rawArguments: unknown): Record<string, unknown> {
  if (typeof rawArguments !== "object" || rawArguments === null || Array.isArray(rawArguments)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(rawArguments).filter(([, value]) => value !== null && value !== undefined)
  );
}

function schemaInputs(shape: InputShape): SchemaInputs {
  const fields = Object.entries(shape);
  return {
    optional: new Set(
      fields.filter(([, schema]) => z.safeParse(schema, undefined).success).map(([input]) => input)
    ),
    allowedOptions: new Map(
      fields.flatMap(([input, schema]) => {
        const allowed = optionsAllowedBy(schema);
        return allowed ? [[input, allowed] as const] : [];
      })
    ),
  };
}

function optionsAllowedBy(schema: z.core.$ZodType): ReadonlySet<string> | undefined {
  const inner = unwrapped(schema);
  const element = inner instanceof z.ZodArray ? unwrapped(inner.element) : inner;
  if (element instanceof z.ZodEnum) return new Set(element.options.map(String));
  if (element instanceof z.ZodBoolean) return BOOLEAN_OPTIONS;
  return undefined;
}

function unwrapped(schema: z.core.$ZodType): z.core.$ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return unwrapped(schema.unwrap());
  }
  return schema;
}

function sorted(names: string[]): string[] {
  return [...new Set(names)].sort();
}
