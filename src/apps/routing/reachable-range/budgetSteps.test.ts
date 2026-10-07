/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import { budgetSteps } from "./budgetSteps";

const values = (args: Parameters<typeof budgetSteps>[0]) =>
  budgetSteps(args).map((step) => step.value);

describe("budgetSteps", () => {
  it("offers half, the same, 1.5 and 2 times the requested budget", () => {
    expect(budgetSteps({ timeBudgetInSec: 1800 })).toEqual([
      { multiplier: 0.5, param: "timeBudgetInSec", value: 900 },
      { multiplier: 1, param: "timeBudgetInSec", value: 1800 },
      { multiplier: 1.5, param: "timeBudgetInSec", value: 2700 },
      { multiplier: 2, param: "timeBudgetInSec", value: 3600 },
    ]);
  });

  it("keeps the requested value exactly", () => {
    expect(values({ distanceBudgetInMeters: 10001 })).toEqual([5001, 10001, 15002, 20002]);
  });

  it("drops steps that round to the same value or to zero", () => {
    expect(values({ timeBudgetInSec: 1 })).toEqual([1, 2]);
  });

  it("returns nothing without a budget", () => {
    expect(budgetSteps({ origin: [4.9, 52.37] })).toEqual([]);
    expect(budgetSteps({})).toEqual([]);
  });
});
