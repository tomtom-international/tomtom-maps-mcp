/*
 * Copyright (C) 2025 TomTom NV
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

import { tomtomClient, validateApiKey, API_VERSION } from "../base/tomtomClient";
import { VERSION } from "../../version";
import { logger } from "../../utils/logger";

import { MapOptions, DEFAULT_MAP_OPTIONS } from "./types";

/**
 * Get a static map image
 * @param options Map display options
 * @returns URL to the static map image
 */
export function getStaticMapUrl(options: MapOptions): string {
  validateApiKey();

  // Apply default values
  const width = options.width || DEFAULT_MAP_OPTIONS.width;
  const height = options.height || DEFAULT_MAP_OPTIONS.height;
  const style = options.style || DEFAULT_MAP_OPTIONS.style;
  const layer = options.layer || DEFAULT_MAP_OPTIONS.layer;
  const view = options.view || DEFAULT_MAP_OPTIONS.view; // Geopolitical view
  const format = options.format || DEFAULT_MAP_OPTIONS.format; // png has better quality and supports transparency
  const apiKey = tomtomClient.defaults.params?.key || "";
  const baseUrl = tomtomClient.defaults.baseURL || "";
  const apiVersion = API_VERSION.MAP || 1; // Default to version 1 if not defined

  // Validate dimensions (1-8192 according to documentation)
  if (width < 1 || width > 8192 || height < 1 || height > 8192) {
    throw new Error("Width and height must be between 1 and 8192 pixels");
  }

  // Start building the URL
  let url = `${baseUrl}/map/${apiVersion}/staticimage?key=${apiKey}`;

  // Either center+zoom or bbox must be provided
  if (options.center) {
    const zoom = options.zoom || DEFAULT_MAP_OPTIONS.zoom;

    // Validate zoom level (0-22 according to documentation)
    if (zoom < 0 || zoom > 22) {
      throw new Error("Zoom level must be between 0 and 22");
    }

    url += `&center=${options.center.lon},${options.center.lat}&zoom=${zoom}`;

    logger.debug(
      `Generated static map URL with center: (${options.center.lat}, ${options.center.lon}), zoom: ${zoom}`
    );
  } else if (options.bbox && options.bbox.length === 4) {
    // Bounding box format: [west, south, east, north]
    url += `&bbox=${options.bbox[0]},${options.bbox[1]},${options.bbox[2]},${options.bbox[3]}`;

    logger.debug(`Generated static map URL with bbox: [${options.bbox.join(", ")}]`);
  } else {
    throw new Error("Either center coordinates or bounding box must be provided");
  }

  // Add required parameters
  url +=
    `&format=${format}` +
    `&layer=${layer}` +
    `&style=${style}` +
    `&width=${width}` +
    `&height=${height}` +
    `&view=${view}`;

  // Note: The Static Image API doesn't directly support markers through the URL.
  // If markers are needed, client-side rendering should be used or consider
  // implementing a separate solution such as:
  // 1. Use a server-side image processing library to add markers to the image
  // 2. Use the Vector Map API with a custom style that includes markers
  // 3. Implement client-side marker rendering on top of the static image

  // Add optional parameters
  if (options.language) {
    url += `&language=${options.language}`;
  }

  return url;
}

/**
 * Get a static map image and return it as base64-encoded data
 * @param options Map display options
 * @returns Promise resolving to the image as base64-encoded data
 */
export async function getStaticMapImage(
  options: MapOptions
): Promise<{ base64: string; contentType: string }> {
  try {
    // Get the URL first
    const mapUrl = getStaticMapUrl(options);

    // Use fetch to download the image. Include TomTom-User-Agent header for tracking.
    const response = await fetch(mapUrl, {
      method: "GET",
      headers: {
        "TomTom-User-Agent": `TomTomMCPSDK/${VERSION}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch map image: HTTP ${response.status}`);
    }

    // Get the content type from the response headers
    const contentType = response.headers.get("content-type") || "image/png";

    // Get the image data as an array buffer
    const imageBuffer = await response.arrayBuffer();

    // Convert the buffer to base64
    const base64 = Buffer.from(imageBuffer).toString("base64");

    logger.debug(`Downloaded static map image (${(imageBuffer.byteLength / 1024).toFixed(2)} KB)`);

    return { base64, contentType };
  } catch (error) {
    logger.error(`Failed to download static map: ${error}`);
    throw error;
  }
}
