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

// Handler factory function
export function createStaticMapHandler() {
  return async (params: any) => {
    logger.info(
      { center: { lat: params.center.lat, lon: params.center.lon } },
      "🗺️ Generating static map"
    );
    try {
      const { base64, contentType } = await getStaticMapImage(params);
      logger.info("✅ Static map generated successfully");
      return {
        content: [{ type: "image" as const, data: base64, mimeType: contentType }],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Static map generation failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
