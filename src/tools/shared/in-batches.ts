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
