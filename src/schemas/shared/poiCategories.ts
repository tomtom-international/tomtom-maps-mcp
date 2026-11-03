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
 * What every `poiCategories` input tells the model it may send.
 */

/**
 * The `poiCategories` field description, shared by the tools that accept it. It says
 * natural language is accepted, which is what lets a model skip the category lookup.
 */
export const POI_CATEGORIES_DOC =
  'Category filter. Natural language IS accepted — "italian food", "gym", "ev charging" are ' +
  "resolved to codes server-side, so you do NOT need to call tomtom-poi-categories first. " +
  "Exact CONSTANT_CASE codes also work and skip the lookup: common ones are RESTAURANT, CAFE, BAR, " +
  "HOTEL, PARK, CHARGING_LOCATION, FUEL_STATION, PARKING_GARAGE, SUPERMARKET, " +
  "PHARMACY, ATM. " +
  "Batch every requested category into ONE array — never one call per category. " +
  "Anything that cannot be resolved is reported back so you know what was dropped.";
