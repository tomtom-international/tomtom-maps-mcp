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
  openNow: boolean;
  /** Today's hours, local to the place, e.g. "08:30–12:00, 13:00–17:30", or "closed". */
  today?: string;
  /** When it closes, local to the place: "HH:MM" today, "YYYY-MM-DD HH:MM" on a later day. */
  closesAt?: string;
  /** When it next opens, in the same form. */
  opensAt?: string;
}

/** A moment's instant; a recorded response holds it as an ISO string rather than a Date. */
const instant = ({ date }: Moment): number => new Date(date).getTime();

const clock = ({ hour, minute }: Moment): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** The place's date now, as the API writes it ("YYYY-MM-DD"); undefined for a zone this runtime lacks. */
function localDate(now: Date, timeZone: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return undefined;
  }
}

/**
 * Summarises the next seven days of opening hours against `now`.
 *
 * @param timeZone The place's IANA zone; without it there is no "today" to name.
 */
export function summarizeOpeningHours(
  hours: OpeningHours,
  timeZone: string | undefined,
  now = new Date()
): OpeningHoursSummary {
  if (hours.alwaysOpenThisPeriod) return { openNow: true, today: "open all day" };

  const today = timeZone ? localDate(now, timeZone) : undefined;
  const at = (moment: Moment): string =>
    moment.dateYYYYMMDD === today ? clock(moment) : `${moment.dateYYYYMMDD} ${clock(moment)}`;

  const time = now.getTime();
  const ranges = [...hours.timeRanges].sort((a, b) => instant(a.start) - instant(b.start));
  const current = ranges.find(({ start, end }) => instant(start) <= time && time < instant(end));
  const next = ranges.find(({ start }) => instant(start) > time);
  const todays = ranges.filter(({ start }) => start.dateYYYYMMDD === today);

  return {
    openNow: Boolean(current),
    ...(today && {
      today: todays.length
        ? todays.map(({ start, end }) => `${clock(start)}–${clock(end)}`).join(", ")
        : "closed",
    }),
    ...(current && { closesAt: at(current.end) }),
    ...(!current && next && { opensAt: at(next.start) }),
  };
}
