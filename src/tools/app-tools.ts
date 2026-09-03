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
 * App-internal tool executors. These are registered with `visibility: "app"`, so
 * the MCP app can call them and the model never sees them.
 */

import { z } from "zod";
import { getEffectiveApiKey, serverUserAgentName } from "../services/api-key";
import { getDataset } from "../services/datasets/dataset-store";
import { buildUserAgent, deriveMcpAppUserAgentName } from "../utils/userAgent";
import type { ToolResponse } from "./shared/tool-entry";

export const getApiKeySchema = {};
export const getAppConfigSchema = {};
export const getDatasetSchema = {
  dataset_id: z.string().describe("Dataset ID from the tool response's _meta.dataset_id"),
};

export async function getApiKeyHandler(): Promise<ToolResponse> {
  const apiKey = getEffectiveApiKey();

  if (!apiKey) {
    return { content: [{ type: "text", text: "API key not available" }], isError: true };
  }

  return { content: [{ type: "text", text: apiKey }], isError: false };
}

export async function getAppConfigHandler(): Promise<ToolResponse> {
  // MCP App traffic mirrors the server identity with the layer token
  // swapped (SDK -> APP), keeping every deployment dimension. Read the
  // live binding inside the handler: setHttpMode() may run after module load.
  const mcpAppUserAgentName = deriveMcpAppUserAgentName(serverUserAgentName);
  const userAgent = buildUserAgent(mcpAppUserAgentName);

  return {
    content: [{ type: "text", text: JSON.stringify({ userAgent }) }],
    isError: false,
  };
}

/**
 * Serves the full stored payload to the MCP app.
 *
 * Returns only `data`, not the envelope: the app wants what it needs to draw, and
 * the summary/provenance around it records what produced it.
 */
export async function getDatasetHandler(params: { dataset_id: string }): Promise<ToolResponse> {
  const dataset = getDataset(params.dataset_id);

  if (!dataset) {
    return {
      content: [{ type: "text", text: "Dataset not found or expired" }],
      isError: true,
    };
  }

  return { content: [{ type: "text", text: JSON.stringify(dataset.data) }], isError: false };
}
