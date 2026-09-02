/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { FindReachableAreasParams } from "../../../schemas/routing/planRouteSchema";

export type Budget = FindReachableAreasParams["budgets"][number];

/** Multiples of the requested budget the widget offers to switch to. */
const MULTIPLIERS = [0.5, 1, 1.5, 2];

/** Seconds and metres are whole numbers; kWh and litres keep one decimal. */
const WHOLE_UNITS: ReadonlySet<Budget["type"]> = new Set(["time", "distance"]);

export interface BudgetStep {
  /** Multiple of the requested budget: 1 is the requested range. */
  multiplier: number;
  /** The budget to call the tool with, in the tool's own unit. */
  budget: Budget;
}

export function roundBudget(value: number, whole: boolean): number {
  return whole ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * The budgets the widget offers, smallest area first, derived from the
 * arguments of the tool call that opened it. Each one is fetched only when the user switches to it.
 * Returns an empty list unless the call asked for exactly one budget: several
 * budgets are rings the caller chose, and all of them are already drawn.
 */
export function budgetSteps(args: Partial<FindReachableAreasParams>): BudgetStep[] {
  if (args.budgets?.length !== 1) return [];
  const [{ type, value: requested }] = args.budgets;

  const steps: BudgetStep[] = [];
  for (const multiplier of MULTIPLIERS) {
    const value =
      multiplier === 1 ? requested : roundBudget(requested * multiplier, WHOLE_UNITS.has(type));
    if (multiplier !== 1) {
      if (value <= 0 || value === requested) continue;
      if (steps.some((step) => step.budget.value === value)) continue;
    }
    steps.push({ multiplier, budget: { type, value } });
  }
  return steps;
}
