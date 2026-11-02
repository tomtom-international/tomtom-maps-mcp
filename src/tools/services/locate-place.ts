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
 * `tomtom-locate-place`: one place for a name, ranked as every place input ranks
 * it (`searchPlaceName`), with the alternatives and how sure the match is.
 */

import { bboxFromBBoxes, type Places } from "@tomtom-org/maps-sdk/core";
import type { LocatePlaceParams } from "../../schemas/search/discoverPlacesSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { runToolQuery } from "../shared/analyse-result";
import { toFeature } from "../shared/geometry-response";
import { candidateLabel, inNamedArea, normaliseName } from "../shared/inputs/place-names";
import {
  boundariesOf,
  knownAreaOf,
  type LookupScope,
  resolveNearby,
  resolveWithin,
  searchPlaceName,
  splitNamedQuery,
} from "../shared/inputs/resolve-where";
import {
  buildErrorResponse,
  buildToolResponse,
  trimSearchResponse,
  withoutOpeningHours,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

/**
 * Works out what area to confine a lookup to, from an explicit `where`. Without
 * one the query's own tail ("Dam Square, Amsterdam") says where, in the ranking.
 */
const resolveLocateScope = async (where: LocatePlaceParams["where"]): Promise<LookupScope> => {
  if (where?.mode === "within") {
    // Only a bbox can constrain a lookup, so a polygon is reduced to its bounds.
    // No position bias with it: a centre point defeats the box ("Dam Square"
    // then geocodes to Beaver Dam Place, Virginia).
    const areas = await resolveWithin(where, { allowCountry: true });
    return { boundingBox: bboxFromBBoxes(areas.map(({ bbox }) => bbox)) };
  }

  if (where?.mode === "nearby") {
    const { position } = await resolveNearby(where);
    return { position, ...(where.radiusMeters !== undefined && { radius: where.radiusMeters }) };
  }

  return {};
};

/**
 * Whether `where` only names again the area the query's own tail names, as in
 * "Dam Square, Amsterdam" within "Amsterdam": the ranking already puts places in
 * that area first, so the area need not be geocoded for its box.
 */
const repeatsQueryArea = (where: LocatePlaceParams["where"], area: string | undefined) =>
  where?.mode === "within" &&
  area !== undefined &&
  !where.areas?.length &&
  !where.boundingBox &&
  !where.geometries?.length &&
  (where.queries ?? []).every((name) => normaliseName(name) === normaliseName(area));

export async function locatePlaceHandler(params: LocatePlaceParams): Promise<ToolResponse> {
  const { query, where, analyse, show_ui = false, response_detail = "compact" } = params;
  const boundaryWanted = response_detail === "geometry";
  logger.info({ query, boundaryWanted }, "Locate place");

  try {
    const { subject, area } = splitNamedQuery(query);
    // A `where` that repeats the query's area is applied only when the best match
    // lies outside it.
    let searched = repeatsQueryArea(where, area) ? await searchPlaceName(query) : undefined;
    if (!searched?.ranked[0] || !inNamedArea(searched.ranked[0], area)) {
      searched = await searchPlaceName(query, await resolveLocateScope(where));
    }
    const { response: found, ranked: features, matchedByName, exactMatches } = searched;

    if (features.length === 0) {
      throw new IncorrectError(
        "Could not locate the query. Try a simpler name, or give `where` to say which area to " +
          "look in.",
        { query }
      );
    }

    const response: Places = { ...found, features };
    if (analyse) return await runToolQuery(analyse, response, "Place lookup");
    const boundaries = boundaryWanted ? await boundariesOf([features[0]]) : undefined;
    const boundary = boundaries?.polygons[0];

    // With no viewport there is nothing to re-rank ambiguous names against, so
    // surface the alternatives instead of pretending the top hit is certain.
    const alternatives = features.slice(1, 4).map(candidateLabel);
    const locatedArea = knownAreaOf(features[0]);

    return await buildToolResponse(
      response,
      (full) => trimSearchResponse({ ...full, features: full.features.slice(0, 1) }),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: withoutOpeningHours({ ...response, features: features.slice(0, 4) }),
        geometry: (full) => [toFeature(boundary ?? full.features[0]?.geometry, { place: 0 })],
        context: {
          located: candidateLabel(features[0]),
          ...(locatedArea && { area: locatedArea }),
          ...(boundaries &&
            !boundary && {
              boundaryNote: boundaries.unavailable
                ? `The boundary service was unavailable (${boundaries.unavailable}), so ` +
                  "`geometry` holds the place's point. Try again for its outline."
                : "The located place has no boundary polygon, so `geometry` holds its point. For " +
                  'a city, district or neighbourhood, name the area itself ("De Jordaan, Amsterdam").',
            }),
          ...(alternatives.length && {
            alternatives,
            note:
              "Several places matched. If the wrong one was chosen, disambiguate with " +
              '`where` (mode "nearby" to bias, "within" to restrict).',
          }),
          // Nothing was NAMED what was asked for, so the best match is an
          // inference; told so, a model reports the doubt rather than
          // substituting coordinates it already believed.
          ...(!matchedByName && {
            matchNote:
              `Nothing is named exactly "${subject}"; \`located\` is the closest match. Answer ` +
              "with its coordinates, naming the place they came from so the user can redirect " +
              "you. Do not replace them with coordinates from memory.",
          }),
          // Two records can share a name and category (Amsterdam has a second
          // "Rijksmuseum" 1.7 km away) in no stable order, so the tie is
          // reported rather than broken by whichever came back first.
          ...(exactMatches > 1 && {
            ambiguityNote:
              `${exactMatches} places are named exactly "${subject}". The first is reported; ` +
              "the rest are in `alternatives`. Narrow with `where` if the wrong one was chosen.",
          }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Locate place");
  }
}
