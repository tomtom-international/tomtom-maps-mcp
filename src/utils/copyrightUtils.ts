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

import { tomtomClient } from "../services/base/tomtomClient";
import { logger } from "./logger";

/**
 * Fetch dynamic copyright text based on map style
 * @param useOrbis - Whether to use TomTom Orbis Maps (true) or TomTom Maps (false) style
 * @returns Promise resolving to copyright text
 */
export async function fetchCopyrightCaption(useOrbis: boolean): Promise<string> {
  try {
    let copyrightUrl: string;
    let requestParams: Record<string, unknown> = {};

    if (useOrbis) {
      copyrightUrl = "maps/orbis/copyrights/caption.json";
      requestParams = { apiVersion: 1 };
    } else {
      copyrightUrl = "map/2/copyrights/caption.json";
      // No additional params needed for TomTom Maps
    }

    const response = await tomtomClient.get(copyrightUrl, {
      responseType: "json",
      params: requestParams,
    });

    if (response.data && response.data.copyrightsCaption) {
      return response.data.copyrightsCaption;
    } else {
      // Fallback to static text if API call fails
      return useOrbis ? "©TomTom, ©OpenStreetMap" : "©TomTom";
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message }, "Failed to fetch copyright caption. Using fallback.");
    // Fallback to static text if API call fails
    return useOrbis ? "©TomTom, ©OpenStreetMap" : "©TomTom";
  }
}
