/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { ReachableRangeParams } from "../../../schemas/routing/routingSchema";

/** The tool's budget parameters, in the precedence order of the server's buildBudget. */
const BUDGET_PARAMS = [
  "timeBudgetInSec",
  "distanceBudgetInMeters",
  "fuelBudgetInLiters",
  "energyBudgetInkWh",
  "chargeBudgetPercent",
  "remainingChargeBudgetPercent",
] as const satisfies readonly (keyof ReachableRangeParams)[];

type BudgetParam = (typeof BUDGET_PARAMS)[number];

/** Multiples of the requested budget the widget offers to switch to. */
const MULTIPLIERS = [0.5, 1, 1.5, 2];

/** Seconds and meters are whole numbers; the other budgets keep one decimal. */
const WHOLE_UNITS: ReadonlySet<BudgetParam> = new Set([
  "timeBudgetInSec",
  "distanceBudgetInMeters",
]);

export interface BudgetStep {
  /** Multiple of the requested budget: 1 is the requested range. */
  multiplier: number;
  /** The budget parameter to call the tool with. */
  param: BudgetParam;
  /** Its value, in the parameter's own unit. */
  value: number;
}

export function roundBudget(value: number, whole: boolean): number {
  return whole ? Math.round(value) : Math.round(value * 10) / 10;
}

/** Whether the vehicle can reach the budget, given its battery in the call's arguments. */
function reachable(
  param: BudgetParam,
  value: number,
  args: Partial<ReachableRangeParams>
): boolean {
  const { currentChargeInkWh: current, maxChargeInkWh: max } = args;
  const currentPct = current !== undefined && max ? (current / max) * 100 : 100;
  switch (param) {
    case "chargeBudgetPercent":
      return value <= Math.min(100, currentPct);
    case "remainingChargeBudgetPercent":
      return value < currentPct;
    case "energyBudgetInkWh":
      return value <= (current ?? max ?? Infinity);
    default:
      return true;
  }
}

/**
 * The budgets the widget offers, smallest area first, derived from the
 * arguments of the tool call that opened it. Each one is fetched only when the user switches to it.
 * Returns an empty list when the arguments carry no budget.
 */
export function budgetSteps(args: Partial<ReachableRangeParams>): BudgetStep[] {
  for (const param of BUDGET_PARAMS) {
    const requested = args[param];
    if (requested === undefined) continue;

    const steps: BudgetStep[] = [];
    for (const multiplier of MULTIPLIERS) {
      const value: number =
        multiplier === 1 ? requested : roundBudget(requested * multiplier, WHOLE_UNITS.has(param));
      if (multiplier !== 1) {
        if (value <= 0 || value === requested || !reachable(param, value, args)) continue;
        if (steps.some((step) => step.value === value)) continue;
      }
      steps.push({ multiplier, param, value });
    }
    // A higher remaining-charge floor reaches less far, so list it from the
    // highest floor down: every budget then reads from the smallest area up.
    return param === "remainingChargeBudgetPercent" ? steps.reverse() : steps;
  }
  return [];
}
