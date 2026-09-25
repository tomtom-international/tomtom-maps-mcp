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

/**
 * Type definitions for TomTom Search API
 */

/**
 * Base interface for common search options
 */
export interface BaseSearchOptions {
  limit?: number;
  typeahead?: boolean;
  lat?: number;
  lon?: number;
  radius?: number;
  countrySet?: string;
  topLeft?: string;
  btmRight?: string;
  language?: string;
  categorySet?: string;
  brandSet?: string;
  ofs?: number;
  mapcodes?: Array<string>; // Array of mapcode types
  timeZone?: string;
  view?: string;
  relatedPois?: string;
  geometries?: boolean;
  sort?: string;
  extendedPostalCodesFor?: string;
  entityTypeSet?: string;
  addressRanges?: boolean;
  minFuzzyLevel?: number;
  maxFuzzyLevel?: number;
  ext?: string;
}
