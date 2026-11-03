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
 * Fan-out for a `where` that resolves to SEVERAL areas that cannot share one
 * request (traffic: its 10,000 km² cap applies to each request's bounds, so two
 * distant cities need one each).
 */

import { failureMessage } from "../../utils/apiErrorHandler";

/** Requests in flight at once, so a many-area query does not arrive as a burst. */
const AREA_REQUEST_CONCURRENCY = 6;

/**
 * Queries every area, {@link AREA_REQUEST_CONCURRENCY} at a time, and keeps the ones
 * that answered. Settling rather than rejecting keeps one bad area from discarding
 * the rest.
 *
 * One bad area returns the rest, with why each other one failed so the response
 * can say so; every area failing is a failed lookup, not an empty one, and rethrows.
 */
export const queryAreas = async <T, R>(
  areas: readonly T[],
  task: (area: T) => Promise<R>,
  context: string
): Promise<{ succeeded: R[]; failures: string[] }> => {
  const settled: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < areas.length; index += AREA_REQUEST_CONCURRENCY) {
    const chunk = areas.slice(index, index + AREA_REQUEST_CONCURRENCY);
    settled.push(...(await Promise.allSettled(chunk.map(task))));
  }
  const succeeded = settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : []
  );
  if (!succeeded.length) throw (settled[0] as PromiseRejectedResult).reason;
  const failures = settled.flatMap((outcome) =>
    outcome.status === "rejected" ? [failureMessage(outcome.reason, context)] : []
  );
  return { succeeded, failures };
};

/**
 * Keeps the first item per `key`, in order, and counts the rest: overlapping
 * areas return the same records, and the count is reported rather than hidden.
 */
export const dedupeBy = <T>(
  items: readonly T[],
  key: (item: T) => string
): { unique: T[]; duplicates: number } => {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
  return { unique, duplicates: items.length - unique.length };
};
