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
 *
 * How far a demanding task's answer may be from the oracle's reference, as numbers. The rubric
 * the judge reads is rendered from them, so the judge and any check in code see one margin.
 */

type Unit = "m" | "km" | "minutes";

/** An allowed margin either side of the reference value. */
export type Tolerance =
  /** A fixed amount: `{ absolute: 50, unit: "m" }` is ±50 m. */
  | { absolute: number; unit?: Unit }
  /** A share of the reference: `{ relative: 0.15 }` is ±15%. */
  | { relative: number }
  /** Percentage points, for an answer that is itself a share. */
  | { points: number }
  /** `relative`, except `absolute` while the reference is under `below`. */
  | { relative: number; absolute: number; below: number; unit?: Unit };

const amount = (value: number, unit?: Unit): string => (unit ? `${value} ${unit}` : `${value}`);

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** A margin as a rubric writes it: "±2", "±50 m", "±15%", "±25% (±3 when the reference is under 12)". */
export function formatTolerance(tolerance: Tolerance): string {
  if ("points" in tolerance) return `±${tolerance.points} percentage points`;
  if ("below" in tolerance) {
    const { relative, absolute, below, unit } = tolerance;
    return `±${percent(relative)} (±${amount(absolute, unit)} when the reference is under ${amount(below, unit)})`;
  }
  if ("relative" in tolerance) return `±${percent(tolerance.relative)}`;
  return `±${amount(tolerance.absolute, tolerance.unit)}`;
}

/**
 * A task's margins and the rubric rendered from them: `rubric` gets each margin formatted
 * under its name, to write "A count within ${within.count} of the reference".
 */
export function measured<const Name extends string>(
  tolerance: Readonly<Record<Name, Tolerance>>,
  rubric: (within: Readonly<Record<Name, string>>) => string
): { tolerance: Readonly<Record<Name, Tolerance>>; rubric: string } {
  const within = Object.fromEntries(
    Object.entries<Tolerance>(tolerance).map(([name, margin]) => [name, formatTolerance(margin)])
  ) as Record<Name, string>;
  return { tolerance, rubric: rubric(within) };
}
