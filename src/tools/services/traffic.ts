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
 * Traffic tool executor. Replaces `handlers/trafficHandler.ts`.
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";
import type { TrafficParams } from "../../schemas/traffic/trafficSchema";
import { getTrafficIncidents } from "../../services/traffic/trafficService";
import { defineDataTool } from "../shared/define-data-tool";
import { capTrafficIncidents, trimTrafficResponse } from "../shared/response-trimmer";

export const trafficHandler = defineDataTool<TrafficParams, { incidents?: unknown[] }>({
  verb: "Traffic lookup",
  name: "tomtom-traffic",
  kind: "incidents",
  execute: (trafficParams) => {
    if (!trafficParams.bbox) {
      throw new Error("bbox parameter must be provided");
    }
    // The schema keeps `timeValidityFilter` as a plain string; the service
    // narrows it to the API's enum.
    return getTrafficIncidents(
      trafficParams.bbox as BBox,
      {
        language: trafficParams.language,
        categoryFilter: trafficParams.categoryFilter,
        timeValidityFilter: trafficParams.timeValidityFilter,
        maxResults: trafficParams.maxResults,
      } as Parameters<typeof getTrafficIncidents>[1]
    );
  },
  // Cap first (agent-facing only — the uncapped result is what gets cached for
  // the map UI), then trim fields.
  project: (result, params) => trimTrafficResponse(capTrafficIncidents(result, params.maxResults)),
  // Compact JSON to minimise tokens on dense bboxes.
  pretty: false,
  logResult: (result) => ({ incident_count: result?.incidents?.length ?? 0 }),
});
