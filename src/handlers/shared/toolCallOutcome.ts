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

import { AsyncLocalStorage } from "node:async_hooks";
import { type ErrorOutcome, type ErrorWithData, errorOutcome } from "../../types/types";

export type ToolCallOutcome =
  | { outcome: "ok"; degraded?: true }
  | { outcome: "retired" | "previous_contract" }
  | (ErrorOutcome & { error?: string });

interface OutcomeSlot {
  outcome?: ToolCallOutcome;
}

const slots = new AsyncLocalStorage<OutcomeSlot>();

export async function withRecordedOutcome<T>(
  run: () => Promise<T>
): Promise<{ result: T; outcome?: ToolCallOutcome }> {
  const slot: OutcomeSlot = {};
  const result = await slots.run(slot, run);
  return { result, outcome: slot.outcome };
}

export function recordOutcome(outcome: ToolCallOutcome): void {
  const slot = slots.getStore();
  if (slot) slot.outcome = outcome;
}

// Every recorded failure is an outcome, but not vice-versa
export function recordFailure(error: ErrorWithData): void {
  const outcome = errorOutcome(error);
  recordOutcome(
    outcome.outcome === "tool_error"
      ? { ...outcome, error: String(error.cause ?? error.message) }
      : outcome
  );
}
