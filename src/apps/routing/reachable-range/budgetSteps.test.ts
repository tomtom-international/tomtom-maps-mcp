/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import { type Budget, budgetSteps } from "./budgetSteps";

const values = (budget: Budget) =>
  budgetSteps({ budgets: [budget] }).map((step) => step.budget.value);

describe("budgetSteps", () => {
  it("offers half, the same, 1.5 and 2 times the requested budget", () => {
    expect(budgetSteps({ budgets: [{ type: "time", value: 1800 }] })).toEqual([
      { multiplier: 0.5, budget: { type: "time", value: 900 } },
      { multiplier: 1, budget: { type: "time", value: 1800 } },
      { multiplier: 1.5, budget: { type: "time", value: 2700 } },
      { multiplier: 2, budget: { type: "time", value: 3600 } },
    ]);
  });

  it("keeps the requested value exactly", () => {
    expect(values({ type: "distance", value: 10001 })).toEqual([5001, 10001, 15002, 20002]);
    expect(values({ type: "fuel", value: 2.25 })).toEqual([1.1, 2.25, 3.4, 4.5]);
  });

  it("drops steps that round to the same value or to zero", () => {
    expect(values({ type: "time", value: 1 })).toEqual([1, 2]);
  });

  it("offers nothing when the call chose its own rings", () => {
    const budgets: Budget[] = [
      { type: "time", value: 600 },
      { type: "time", value: 1200 },
    ];
    expect(budgetSteps({ budgets })).toEqual([]);
  });

  it("returns nothing without a budget", () => {
    expect(budgetSteps({ origins: [{ position: [4.9, 52.37] }] })).toEqual([]);
    expect(budgetSteps({})).toEqual([]);
  });
});
