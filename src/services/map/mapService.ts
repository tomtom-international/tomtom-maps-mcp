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

import { tomtomClient, validateApiKey, API_VERSION } from "../base/tomtomClient";
import { VERSION } from "../../version";
import { logger } from "../../utils/logger";
import { fetchCopyrightCaption, addCopyrightOverlay } from "../../utils/copyrightUtils";
import { UnavailableError } from "../../types/types";

import { MapOptions, DEFAULT_MAP_OPTIONS } from "./types";

// Canvas import will be done dynamically when needed
let createCanvas: any;
let canvasLoadAttempted = false;

/**
 * Dynamically import canvas if available
 */
async function loadCanvasIfAvailable() {
  if (canvasLoadAttempted) {
    return createCanvas !== undefined;
  }

  canvasLoadAttempted = true;

  try {
    const canvasModule = await import("canvas");
    createCanvas = canvasModule.createCanvas;
    return true;
  } catch (error) {
    logger.warn(
      "⚠️ Canvas library not available: copyright overlay will be skipped for static maps"
    );
    return false;
  }
}

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
  const baseUrl = tomtomClient.defaults.baseURL || "";
  const apiVersion = API_VERSION.MAP || 1; // Default to version 1 if not defined

  // Validate dimensions (1-8192 according to documentation)
  if (width < 1 || width > 8192 || height < 1 || height > 8192) {
    throw new Error("Width and height must be between 1 and 8192 pixels");
  }

  // Start building the URL - tomtomClient will automatically append the API key
  let url = `/map/${apiVersion}/staticimage?`;

  // Either center+zoom or bbox must be provided
  if (options.center) {
    const zoom = options.zoom || DEFAULT_MAP_OPTIONS.zoom;

    // Validate zoom level (0-22 according to documentation)
    if (zoom < 0 || zoom > 22) {
      throw new Error("Zoom level must be between 0 and 22");
    }

    url += `center=${options.center.lon},${options.center.lat}&zoom=${zoom}`;

    logger.debug(
      { center: { lat: options.center.lat, lon: options.center.lon }, zoom },
      "Generated static map URL with center"
    );
  } else if (options.bbox && options.bbox.length === 4) {
    // Bounding box format: [west, south, east, north]
    url += `bbox=${options.bbox[0]},${options.bbox[1]},${options.bbox[2]},${options.bbox[3]}`;

    logger.debug({ bbox: options.bbox }, "Generated static map URL with bbox");
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

    logger.debug("Making static map request");

    // Use tomtomClient to download the image (it automatically includes proper headers)
    const response = await tomtomClient.get(mapUrl, {
      responseType: "arraybuffer",
    });

    if (!response.status || response.status >= 400) {
      throw new UnavailableError("Failed to fetch map image", {
        status_code: response.status,
      });
    }

    // Get the content type from the response headers
    const contentType = response.headers?.["content-type"] || "image/png";

    // The image data is already in the response
    const imageBuffer = response.data;

    // Add copyright overlay to the static map image
    let finalImageBuffer = imageBuffer;

    // Try to load Canvas dynamically
    const canvasAvailable = await loadCanvasIfAvailable();

    if (canvasAvailable) {
      try {
        // Fetch Genesis copyright text (static maps are Genesis only)
        const copyrightText = await fetchCopyrightCaption(false);

        // Get image dimensions from options
        const width = options.width || DEFAULT_MAP_OPTIONS.width;
        const height = options.height || DEFAULT_MAP_OPTIONS.height;

        // Create canvas and load the original image
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // Load and draw the original image
        const buffer = Buffer.from(imageBuffer);
        const { loadImage } = await import("canvas");
        const img = await loadImage(buffer);
        ctx.drawImage(img, 0, 0, width, height);

        // Add copyright overlay using shared utility
        addCopyrightOverlay(ctx, copyrightText, width, height);

        // Convert canvas back to buffer
        finalImageBuffer = canvas.toBuffer("image/png");

        logger.debug("Added copyright overlay to static map image");
      } catch (overlayError: any) {
        logger.error(
          { error: overlayError.message },
          "Failed to add copyright overlay to static map. Using original image."
        );
        // Use original image if overlay fails
        finalImageBuffer = imageBuffer;
      }
    } else {
      logger.debug("Canvas not available, skipping copyright overlay for static map");
    }

    // Convert the buffer to base64
    const base64 = Buffer.from(finalImageBuffer).toString("base64");

    const sizeKB = (finalImageBuffer.byteLength / 1024).toFixed(2);
    logger.debug({ size_kb: sizeKB }, "Downloaded and processed static map image");

    return { base64, contentType };
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to download static map");
    throw error;
  }
}
