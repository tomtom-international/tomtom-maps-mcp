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
    expect(values({ fuelBudgetInLiters: 2.25 })).toEqual([1.1, 2.25, 3.4, 4.5]);
  });

  it("caps charge percentages at 100, including a step exactly at the cap", () => {
    expect(values({ chargeBudgetPercent: 60 })).toEqual([30, 60, 90]);
    expect(values({ chargeBudgetPercent: 50 })).toEqual([25, 50, 75, 100]);
  });

  it("caps an energy budget at the battery size", () => {
    expect(values({ energyBudgetInkWh: 40, maxChargeInkWh: 75 })).toEqual([20, 40, 60]);
  });

  it("offers only what the current charge can spend", () => {
    const battery = { currentChargeInkWh: 30, maxChargeInkWh: 75 }; // 40%
    expect(values({ chargeBudgetPercent: 20, ...battery })).toEqual([10, 20, 30, 40]);
    expect(values({ chargeBudgetPercent: 30, ...battery })).toEqual([15, 30]);
    expect(values({ energyBudgetInkWh: 20, ...battery })).toEqual([10, 20, 30]);
  });

  it("offers only remaining-charge floors below the current charge, highest floor first", () => {
    const battery = { currentChargeInkWh: 22.5, maxChargeInkWh: 75 }; // 30%
    expect(values({ remainingChargeBudgetPercent: 20, ...battery })).toEqual([20, 10]);
    expect(values({ remainingChargeBudgetPercent: 80 })).toEqual([80, 40]);
  });

  it("drops steps that round to the same value or to zero", () => {
    expect(values({ timeBudgetInSec: 1 })).toEqual([1, 2]);
  });

  it("returns nothing without a budget", () => {
    expect(budgetSteps({ origin: [4.9, 52.37] })).toEqual([]);
    expect(budgetSteps({})).toEqual([]);
  });
});
