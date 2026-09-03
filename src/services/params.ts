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
 * Helpers for assembling maps-sdk service params.
 *
 * The service wrappers were built as ladders of
 * `if (options?.x !== undefined) params.x = options.x` — one line per optional
 * field, repeated across every function, which is what made a thin remapper look
 * like 60 lines of logic. These two helpers say the same thing declaratively.
 */

/**
 * Drops `undefined` values from an object literal, so an optional field can be
 * written inline instead of behind an `if`.
 *
 * `null`, `0`, `""` and `[]` are KEPT — only `undefined` means "not provided".
 * For "omit when empty" use {@link nonEmpty}.
 */
export function compact<T extends Record<string, unknown>>(params: T): T {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as T;
}

/**
 * `undefined` for an absent or empty array, the array otherwise.
 *
 * Several SDK params reject an empty array (the API treats `countries=` as a
 * filter matching nothing), so the ladders these helpers replace guarded with
 * `if (options?.countries?.length)`. Pair with {@link compact} to keep that
 * behaviour: `compact({ countries: nonEmpty(options?.countries) })`.
 */
export function nonEmpty<T>(value: readonly T[] | undefined): readonly T[] | undefined {
  return value?.length ? value : undefined;
}
