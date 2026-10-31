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
 * A place's opening hours as the answer to "is it open?": the API's seven days of
 * time ranges, read against now in the place's own time zone.
 */

import type { Moment, OpeningHours } from "@tomtom-org/maps-sdk/core";

/** What a compact place result says of its opening hours. */
export interface OpeningHoursSummary {
  /** Absent without the place's time zone, which "now" needs. */
  openNow?: boolean;
  /** Today's hours, local to the place, e.g. "08:30–12:00, 13:00–17:30", or "closed". */
  today?: string;
  /** When it closes, local to the place: "HH:MM" today, "YYYY-MM-DD HH:MM" on a later day. */
  closesAt?: string;
  /** When it next opens, in the same form. */
  opensAt?: string;
  /** Without the place's time zone: its ranges on its own clock, "YYYY-MM-DD HH:MM–HH:MM". */
  ranges?: string[];
}

const clock = ({ hour, minute }: Moment): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/**
 * A moment on the place's wall clock, "YYYY-MM-DD HH:MM", which sorts as it reads.
 * `Moment.date` is that wall-clock time read in the runtime's zone, not the instant,
 * so it is never compared with now.
 */
const wallClock = (moment: Moment): string => `${moment.dateYYYYMMDD} ${clock(moment)}`;

/** Now on the wall clock of `timeZone`, in the same form; undefined for a zone this runtime lacks. */
function wallClockNow(now: Date, timeZone: string): string | undefined {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(now)
        .map(({ type, value }) => [type, value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return undefined;
  }
}

/**
 * Summarises the next seven days of opening hours against `now`.
 *
 * @param timeZone The place's IANA zone; without it there is no "now" to read the hours against.
 */
export function summarizeOpeningHours(
  hours: OpeningHours,
  timeZone: string | undefined,
  now = new Date()
): OpeningHoursSummary {
  if (hours.alwaysOpenThisPeriod) return { openNow: true, today: "open all day" };

  const ranges = [...hours.timeRanges].sort((a, b) =>
    wallClock(a.start).localeCompare(wallClock(b.start))
  );
  const time = timeZone && wallClockNow(now, timeZone);
  if (!time) {
    return { ranges: ranges.map(({ start, end }) => `${wallClock(start)}–${clock(end)}`) };
  }
  const today = time.slice(0, 10);
  const at = (moment: Moment): string =>
    moment.dateYYYYMMDD === today ? clock(moment) : wallClock(moment);

  const current = ranges.find(
    ({ start, end }) => wallClock(start) <= time && time < wallClock(end)
  );
  const next = ranges.find(({ start }) => wallClock(start) > time);
  // A range from last night counts towards today until it closes after midnight.
  const todays = ranges.filter(
    ({ start, end }) =>
      start.dateYYYYMMDD === today ||
      (end.dateYYYYMMDD === today && start.dateYYYYMMDD < today && clock(end) !== "00:00")
  );

  return {
    openNow: Boolean(current),
    today: todays.length
      ? todays.map(({ start, end }) => `${clock(start)}–${clock(end)}`).join(", ")
      : "closed",
    ...(current && { closesAt: at(current.end) }),
    ...(!current && next && { opensAt: at(next.start) }),
  };
}
