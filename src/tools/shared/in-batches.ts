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
 * Fan-out for a `where` that resolves to SEVERAL areas, where the upstream API
 * takes one area per request (traffic: its 10,000 km² cap applies to each
 * request's bounds, so two distant cities cannot share one).
 */

/** Requests in flight at once, so a many-area query does not arrive as a burst. */
const AREA_REQUEST_CONCURRENCY = 6;

/**
 * Runs `task` over `items`, at most `concurrency` at a time. Settling rather than
 * rejecting keeps one bad area from discarding the rest: the caller decides what
 * a partial result means.
 */
const inBatches = async <T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  concurrency: number = AREA_REQUEST_CONCURRENCY
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.allSettled(chunk.map(task))));
  }
  return results;
};

/** The values of the settled results that fulfilled, in order. */
export const fulfilledValues = <R>(settled: readonly PromiseSettledResult<R>[]): R[] =>
  settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));

/** Throws the first rejection, so a failing API is not reported as "nothing found". */
export const throwFirstRejection = (settled: readonly PromiseSettledResult<unknown>[]): void => {
  const rejected = settled.find((outcome) => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
};

/**
 * Queries every area via {@link inBatches} and keeps the ones that answered.
 *
 * One bad area returns the rest, with the failures counted so the response can
 * say so; every area failing is a failed lookup, not an empty one, and rethrows.
 */
export const queryAreas = async <T, R>(
  areas: readonly T[],
  task: (area: T) => Promise<R>
): Promise<{ succeeded: R[]; failed: number }> => {
  const settled = await inBatches(areas, task);
  const succeeded = fulfilledValues(settled);
  if (!succeeded.length) throw (settled[0] as PromiseRejectedResult).reason;
  return { succeeded, failed: settled.length - succeeded.length };
};

/**
 * Every way a fan-out covered less than was asked for, stated rather than left
 * to be inferred from a count. A total that silently covers part of the
 * requested scope is indistinguishable from a correct one unless the response
 * says so.
 */
export const shortfallNotes = ({
  records,
  verb,
  duplicates,
  failed,
}: {
  /** What was merged, capitalised: "Places", "Incidents". */
  records: string;
  /** What was done to each area: "searched", "queried". */
  verb: string;
  duplicates: number;
  failed: number;
}): Record<string, unknown> => ({
  ...(duplicates > 0 && {
    duplicatesMerged: duplicates,
    duplicatesNote:
      `${records} found in more than one area were counted once: the areas overlap or share ` +
      "a border.",
  }),
  ...(failed > 0 && {
    note:
      `${failed} of the resolved areas could not be ${verb}; these results cover the rest. ` +
      "Treat totals as a lower bound.",
  }),
});

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
