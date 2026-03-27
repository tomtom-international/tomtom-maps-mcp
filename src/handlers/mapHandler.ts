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

import { logger } from "../utils/logger";
import { getStaticMapImage } from "../services/map/mapService";
import type { MapOptions } from "../services/map/types";
import type { MapParams } from "../schemas/map/mapSchema";

// Handler factory function
export function createStaticMapHandler() {
  return async (params: MapParams) => {
    const { center } = params;
    logger.info({ center: { lat: center.lat, lon: center.lon } }, "🗺️ Generating static map");
    try {
      // bbox schema type is number[] (Zod .length(4) doesn't narrow to tuple), cast to MapOptions
      const { base64, contentType } = await getStaticMapImage(params as unknown as MapOptions);
      logger.info("✅ Static map generated successfully");
      return {
        content: [{ type: "image" as const, data: base64, mimeType: contentType }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Static map generation failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
