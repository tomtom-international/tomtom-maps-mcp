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

import { tomtomDataVizSchema } from "./dataViz/dataVizSchema";
import { tomtomDynamicMapSchema } from "./map/dynamicMapSchema";
import {
  tomtomEvRoutingSchema,
  tomtomReachableRangeSchema,
  tomtomRoutingSchema,
} from "./routing/routingSchema";
import {
  tomtomAreaSearchSchema,
  tomtomEvSearchSchema,
  tomtomFuzzySearchSchema,
  tomtomGeocodeSearchSchema,
  tomtomNearbySearchSchema,
  tomtomPOICategoriesSchema,
  tomtomPOISearchSchema,
  tomtomReverseGeocodeSearchSchema,
  tomtomSearchAlongRouteSchema,
} from "./search/searchSchema";
import { tomtomTrafficSchema } from "./traffic/trafficSchema";

export const schemas = {
  tomtomFuzzySearchSchema,
  tomtomPOISearchSchema,
  tomtomNearbySearchSchema,
  tomtomGeocodeSearchSchema,
  tomtomReverseGeocodeSearchSchema,
  tomtomRoutingSchema,
  tomtomReachableRangeSchema,
  tomtomDynamicMapSchema,
  tomtomTrafficSchema,
  tomtomEvSearchSchema,
  tomtomEvRoutingSchema,
  tomtomSearchAlongRouteSchema,
  tomtomAreaSearchSchema,
  tomtomDataVizSchema,
  tomtomPOICategoriesSchema,
};
