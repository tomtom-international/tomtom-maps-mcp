/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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
 * Records the live answers the place-name tests replay, cut to the fields the
 * ranking reads: for each landmark, the tail's area, the POI index and the
 * geocoder, asked as `tomtom-locate-place` asks them; and the POI category list.
 *
 *   TOMTOM_API_KEY=… npx tsx scripts/record-place-fixtures.ts
 *   npx biome format --write src/tools/shared/__fixtures__
 */

import { writeFileSync } from "node:fs";
import type { Place, Places } from "@tomtom-org/maps-sdk/core";
import {
  geocodeAddress,
  geocodeAreas,
  poiSearch,
  resolveCategories,
} from "../src/services/search/searchService";
import { LANDMARKS } from "../src/tools/shared/__fixtures__/landmarks";
import { splitNamedQuery } from "../src/tools/shared/inputs/resolve-where";

const FIXTURES = new URL("../src/tools/shared/__fixtures__/", import.meta.url);

/** The categories the resolver test asks for, by name, with the ones that compete for its words. */
const CATEGORY_NAMES = /restaurant|caf[eé]|charg|fuel|petrol|gym|fitness/i;

const cut = ({ id, type, geometry, bbox, properties }: Place) => ({
  id,
  type,
  geometry,
  ...(bbox && { bbox }),
  properties: {
    type: properties.type,
    ...(properties.poi && { poi: { name: properties.poi.name } }),
    address: {
      freeformAddress: properties.address?.freeformAddress,
      municipality: properties.address?.municipality,
      country: properties.address?.country,
    },
    ...(properties.dataSources?.geometry && {
      dataSources: { geometry: properties.dataSources.geometry },
    }),
  },
});
const cutAll = ({ features }: Places) => ({
  type: "FeatureCollection",
  features: features.map(cut),
});

const landmarks: Record<string, unknown> = {};
for (const { query } of LANDMARKS) {
  const { area } = splitNamedQuery(query);
  const areas = area ? await geocodeAreas(area, { limit: 1 }) : undefined;
  const boundingBox = areas?.features[0]?.bbox;
  const options = { limit: 5, ...(boundingBox && { boundingBox }) };
  const [poi, geocode] = await Promise.all([
    poiSearch(query, options),
    geocodeAddress(query, options),
  ]);
  landmarks[query] = {
    ...(areas && { area: cutAll(areas) }),
    poi: cutAll(poi),
    geocode: cutAll(geocode),
  };
}
writeFileSync(new URL("landmarks.json", FIXTURES), `${JSON.stringify(landmarks, null, 2)}\n`);

// The category list as the API sends it, caught on its way into the SDK's matcher.
type CategoryList = { poiCategories: { name: string }[] };
let categories: CategoryList | undefined;
const sdkFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await sdkFetch(input, init);
  if (String(input instanceof Request ? input.url : input).includes("poiCategories.json")) {
    categories = (await response.clone().json()) as CategoryList;
  }
  return response;
};
await resolveCategories(["italian food"]);
if (!categories) throw new Error("The SDK fetched no category list");
writeFileSync(
  new URL("poi-categories.json", FIXTURES),
  `${JSON.stringify(
    { poiCategories: categories.poiCategories.filter(({ name }) => CATEGORY_NAMES.test(name)) },
    null,
    2
  )}\n`
);
