/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** The tool's budget parameters; a call sets exactly one. */
const BUDGET_PARAMS = [
  "timeBudgetInSec",
  "distanceBudgetInMeters",
  "fuelBudgetInLiters",
  "energyBudgetInkWh",
  "chargeBudgetPercent",
  "remainingChargeBudgetPercent",
] as const;

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

function round(value: number, param: BudgetParam): number {
  return WHOLE_UNITS.has(param) ? Math.round(value) : Math.round(value * 10) / 10;
}

/** The largest value the budget parameter can take, given the other arguments. */
function cap(param: BudgetParam, args: Record<string, unknown>): number {
  if (param === "chargeBudgetPercent" || param === "remainingChargeBudgetPercent") return 100;
  if (param === "energyBudgetInkWh" && typeof args.maxChargeInkWh === "number") {
    return args.maxChargeInkWh;
  }
  return Infinity;
}

/**
 * The budgets the widget offers, derived from the arguments of the tool call
 * that opened it. Each one is fetched only when the user switches to it.
 * Returns an empty list when the arguments carry no budget.
 */
export function budgetSteps(args: Record<string, unknown>): BudgetStep[] {
  const param = BUDGET_PARAMS.find((name) => typeof args[name] === "number");
  if (!param) return [];

  const requested = args[param] as number;
  const max = cap(param, args);
  const steps: BudgetStep[] = [];
  for (const multiplier of MULTIPLIERS) {
    const value = multiplier === 1 ? requested : round(requested * multiplier, param);
    if (multiplier !== 1) {
      if (value <= 0 || value > max || value === requested) continue;
      if (steps.some((step) => step.value === value)) continue;
    }
    steps.push({ multiplier, param, value });
  }
  return steps;
}
