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
 */

import type { Moment, OpeningHours } from "@tomtom-org/maps-sdk/core";
import { describe, expect, it } from "vitest";
import { summarizeOpeningHours } from "./opening-hours";

const AMSTERDAM = "Europe/Amsterdam";

/** A moment as the maps-sdk builds it: the place's wall clock, read in the runtime's zone. */
const moment = (day: number, hour: number, minute = 0): Moment => ({
  date: new Date(2026, 8, day, hour, minute),
  dateYYYYMMDD: `2026-09-${day}`,
  year: 2026,
  month: 9,
  day,
  hour,
  minute,
});

const hours = (...ranges: [number, number, number][]): OpeningHours => ({
  mode: "nextSevenDays",
  timeRanges: ranges.map(([day, from, to]) => ({ start: moment(day, from), end: moment(day, to) })),
  alwaysOpenThisPeriod: false,
});

/** 24 September 2026 at `hour` in Amsterdam. */
const on24th = (hour: number): Date => new Date(Date.UTC(2026, 8, 24, hour - 2));

describe("summarizeOpeningHours", () => {
  const lunchAndDinner = hours([24, 11, 14], [24, 17, 22], [25, 11, 14]);

  it("says a place is open and when it closes, in its own time", () => {
    expect(summarizeOpeningHours(lunchAndDinner, AMSTERDAM, on24th(12))).toEqual({
      openNow: true,
      today: "11:00–14:00, 17:00–22:00",
      closesAt: "14:00",
    });
  });

  it("says when a closed place next opens, with the date when that is not today", () => {
    expect(summarizeOpeningHours(lunchAndDinner, AMSTERDAM, on24th(15))).toMatchObject({
      openNow: false,
      opensAt: "17:00",
    });
    expect(summarizeOpeningHours(lunchAndDinner, AMSTERDAM, on24th(23))).toMatchObject({
      openNow: false,
      opensAt: "2026-09-25 11:00",
    });
  });

  it("reads the hours on the place's own clock, whatever the server's zone", () => {
    // 10:00 in Tokyo is 01:00 UTC, before a 09:00 opening on any other clock.
    const at10InTokyo = new Date(Date.UTC(2026, 8, 24, 1));
    expect(summarizeOpeningHours(hours([24, 9, 17]), "Asia/Tokyo", at10InTokyo)).toEqual({
      openNow: true,
      today: "09:00–17:00",
      closesAt: "17:00",
    });
  });

  it("counts a night that runs past midnight towards the day it closes on", () => {
    const lateBar: OpeningHours = {
      mode: "nextSevenDays",
      timeRanges: [{ start: moment(23, 22), end: moment(24, 2) }],
      alwaysOpenThisPeriod: false,
    };
    expect(summarizeOpeningHours(lateBar, AMSTERDAM, on24th(1))).toEqual({
      openNow: true,
      today: "22:00–02:00",
      closesAt: "02:00",
    });
  });

  it("calls a day without ranges closed", () => {
    expect(summarizeOpeningHours(hours([25, 11, 14]), AMSTERDAM, on24th(12)).today).toBe("closed");
  });

  it("reads moments recorded as ISO strings", () => {
    const recorded = JSON.parse(JSON.stringify(lunchAndDinner)) as OpeningHours;
    expect(summarizeOpeningHours(recorded, AMSTERDAM, on24th(12)).openNow).toBe(true);
  });

  it("lists the ranges, and says nothing of now, without a time zone to read them in", () => {
    expect(summarizeOpeningHours(lunchAndDinner, undefined, on24th(12))).toEqual({
      ranges: ["2026-09-24 11:00–14:00", "2026-09-24 17:00–22:00", "2026-09-25 11:00–14:00"],
    });
  });

  it("says a place open all week is open all day", () => {
    const always: OpeningHours = { ...hours(), alwaysOpenThisPeriod: true };
    expect(summarizeOpeningHours(always, AMSTERDAM, on24th(3))).toEqual({
      openNow: true,
      today: "open all day",
    });
  });
});
