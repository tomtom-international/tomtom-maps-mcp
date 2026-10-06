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
 * Fan-out for the tools that resolve `where` into SEVERAL areas.
 *
 * `where.mode: "within"` can name more than one area, and one name can resolve
 * to more than one polygon — three isochrone budgets come back as twelve rings,
 * not three. The upstream APIs take a single geometry per call, so covering the
 * requested scope means one request per area, and the only question is how they
 * are paced.
 */

/**
 * Requests in flight at once, so a two-dozen-area query does not arrive as a
 * burst and earn a rate limit.
 */
export const AREA_REQUEST_CONCURRENCY = 6;

/**
 * How many resolved areas one call will query.
 *
 * There has to be a ceiling — a caller can name arbitrarily many areas — but it
 * has to clear the ordinary case: three time budgets from one origin resolve to
 * TWELVE polygons, since an isochrone comes back as several rings. A cap of 8
 * silently clipped a routine query, which is the same quiet partial answer this
 * fan-out exists to remove. Twenty-four covers five budgets' worth.
 */
export const MAX_AREAS_SEARCHED = 24;

/**
 * Runs `task` over `items`, at most `concurrency` at a time.
 *
 * `Promise.allSettled` over two dozen requests would hit the API as one burst;
 * sequential would make a 24-area query take 24 round trips. Chunks are the
 * cheap middle, and settling rather than rejecting keeps one bad area from
 * discarding the rest — the caller decides what a partial result means.
 */
export const inBatches = async <T, R>(
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

/** The first {@link MAX_AREAS_SEARCHED} areas, and how many were left out. */
export const capAreas = <T>(areas: readonly T[]): { searched: T[]; unsearched: number } => {
  const searched = areas.slice(0, MAX_AREAS_SEARCHED);
  return { searched, unsearched: areas.length - searched.length };
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
  unsearched,
}: {
  /** What was merged, capitalised: "Places", "Incidents". */
  records: string;
  /** What was done to each area: "searched", "queried". */
  verb: string;
  duplicates: number;
  failed: number;
  unsearched: number;
}): Record<string, unknown> => ({
  ...(duplicates > 0 && {
    duplicatesMerged: duplicates,
    duplicatesNote:
      `${records} found in more than one area were counted once. Overlapping or nested areas ` +
      "(isochrone budgets, for instance) are the usual cause.",
  }),
  ...(failed > 0 && {
    note:
      `${failed} of the resolved areas could not be ${verb}; these results cover the rest. ` +
      "Treat totals as a lower bound.",
  }),
  ...(unsearched > 0 && {
    unsearchedAreas: unsearched,
    unsearchedNote:
      `${unsearched} further area(s) were resolved but not ${verb} (limit of ` +
      `${MAX_AREAS_SEARCHED} per call) — narrow \`where\` or issue another call.`,
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
