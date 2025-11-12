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

import type { CanvasRenderingContext2D } from "canvas";
import { tomtomClient } from "../services/base/tomtomClient";
import { logger } from "./logger";

/**
 * Fetch dynamic copyright text based on map style
 * @param useOrbis - Whether to use Orbis (true) or Genesis (false) style
 * @returns Promise resolving to copyright text
 */
export async function fetchCopyrightCaption(useOrbis: boolean): Promise<string> {
  try {
    let copyrightUrl: string;
    let requestParams: any = {};
    
    if (useOrbis) {
      copyrightUrl = 'maps/orbis/copyrights/caption.json';
      requestParams = { apiVersion: 1 };
    } else {
      copyrightUrl = 'map/2/copyrights/caption.json';
      // No additional params needed for Genesis
    }

    const response = await tomtomClient.get(copyrightUrl, {
      responseType: 'json',
      params: requestParams
    });

    if (response.data && response.data.copyrightsCaption) {
      return response.data.copyrightsCaption;
    } else {
      // Fallback to static text if API call fails
      return useOrbis ? '©TomTom, ©OpenStreetMap' : '©TomTom';
    }
  } catch (error: any) {
    logger.warn(`Failed to fetch copyright caption: ${error.message}. Using fallback.`);
    // Fallback to static text if API call fails
    return useOrbis ? '©TomTom, ©OpenStreetMap' : '©TomTom';
  }
}

/**
 * Add copyright overlay to a canvas context
 * @param ctx - Canvas 2D rendering context
 * @param copyrightText - Copyright text to display
 * @param width - Canvas width
 * @param height - Canvas height
 */
export function addCopyrightOverlay(
  ctx: CanvasRenderingContext2D,
  copyrightText: string,
  width: number,
  height: number
): void {
  // Add copyright overlay with consistent positioning
  const copyrightDisplayText = copyrightText || "© TomTom";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  
  // Measure text dimensions
  const textMetrics = ctx.measureText(copyrightDisplayText);
  const textWidth = Math.ceil(textMetrics.width);
  const textHeight = 16; // Approximate height for 14px font
  const padding = 6; // Padding around text
  
  // Calculate background rectangle dimensions and position
  // Position: right: 100px, bottom: 8px (consistent across both services)
  const bgWidth = textWidth + (padding * 2);
  const bgHeight = textHeight + (padding * 2);
  const bgX = width - bgWidth - 100; // 100px margin from right edge
  const bgY = height - bgHeight - 8; // 8px margin from bottom edge
  
  // Draw background rectangle
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
  
  // Draw text
  ctx.fillStyle = "#000";
  ctx.fillText(copyrightDisplayText, width - padding - 100, height - padding - 8);
}