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
import { handleApiError } from "../utils/apiErrorHandler";
import { buildDynamicMap } from "../services/map/dynamicMapService";
import { storeVizData } from "../services/cache/vizCache";
import type {
  DynamicMapOptions,
  DynamicMapResponse,
  RoutePlanOutcome,
} from "../services/map/dynamicMapTypes";
import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";

const APP_NOTE =
  "The interactive map is rendered by the tomtom-dynamic-map MCP app when the client supports MCP Apps; " +
  "clients without MCP Apps support receive only this text summary.";

const NO_APP_NOTE =
  "No interactive map was requested (show_ui: false); this text summary is the whole result.";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatKilometres(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function describeRoutePlan(plan: RoutePlanOutcome, index: number): string {
  let line = `${index + 1}. ${plan.label}`;
  if (plan.originLabel || plan.destinationLabel) {
    line += ` (${plan.originLabel ?? "origin"} → ${plan.destinationLabel ?? "destination"})`;
  }
  if (plan.waypointCount > 0) {
    line += ` via ${plural(plan.waypointCount, "waypoint")}`;
  }

  if (plan.error) {
    return `${line}: could not calculate the route (${plan.error})`;
  }

  line += `: ${formatKilometres(plan.lengthInMeters ?? 0)}, ${formatDuration(plan.travelTimeInSeconds ?? 0)} by ${plan.travelMode}`;
  if (plan.trafficDelayInSeconds && plan.trafficDelayInSeconds > 0) {
    line += ` (includes ${formatDuration(plan.trafficDelayInSeconds)} traffic delay)`;
  }
  return line;
}

/**
 * Plain-text description of the map, useful on its own to the model and to
 * clients that cannot display the MCP app.
 */
export function describeDynamicMap(result: DynamicMapResponse, showUI: boolean): string {
  const { summary, mapState } = result;
  const [lon, lat] = mapState.view.center;
  const lines: string[] = [
    `Dynamic map: ${result.width}x${result.height} px viewport centred on ${lat.toFixed(5)}, ${lon.toFixed(5)} at zoom ${mapState.view.zoom}.`,
  ];

  const hasRouteMarkers = summary.routePlans.length > 0 || summary.lines > 0;
  const contents = [
    plural(summary.markers, "marker") +
      (hasRouteMarkers && summary.markers > 0 ? " (including route start and end markers)" : ""),
    plural(summary.polygons, "polygon"),
    plural(summary.lines, "drawn line"),
    plural(summary.routePlans.length, "calculated route"),
  ];
  lines.push(`Contents: ${contents.join(", ")}.`);

  if (summary.ignoredLines > 0) {
    lines.push(
      `${plural(summary.ignoredLines, "drawn line")} from 'routes' ${summary.ignoredLines === 1 ? "was" : "were"} not shown because 'routePlans' were given.`
    );
  }

  if (summary.routePlans.length > 0) {
    lines.push("Routes:");
    summary.routePlans.forEach((plan, index) => lines.push(describeRoutePlan(plan, index)));
  }

  lines.push(showUI ? APP_NOTE : NO_APP_NOTE);
  return lines.join("\n");
}

/**
 * Handler factory for tomtom-dynamic-map.
 *
 * Returns a text summary of the map plus the `_meta` block the MCP app reads.
 * With show_ui on, the map state is cached and the app fetches it by viz_id to
 * draw the map client-side.
 */
export function createDynamicMapHandler() {
  return async (params: DynamicMapParams) => {
    const { show_ui = true, ...mapParams } = params;

    logger.info({ show_ui }, "Processing dynamic map request");

    try {
      const result = await buildDynamicMap(mapParams as unknown as DynamicMapOptions);

      const content: Array<{ type: "text"; text: string }> = [
        { type: "text" as const, text: describeDynamicMap(result, show_ui) },
      ];

      if (show_ui) {
        const vizId = await storeVizData(result.mapState);
        content.push({
          type: "text" as const,
          text: JSON.stringify({ _meta: { show_ui: true, viz_id: vizId } }, null, 2),
        });
        logger.debug({ viz_id: vizId }, "Cached map state for MCP app");
      } else {
        content.push({
          type: "text" as const,
          text: JSON.stringify({ _meta: { show_ui: false } }, null, 2),
        });
      }

      return { content };
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Dynamic map generation");
      logger.error({ error: formattedError.message }, "Dynamic map generation failed");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: formattedError.message }),
          },
        ],
        isError: true,
      };
    }
  };
}
