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

import { FaultError } from "../types/types";
import { logger } from "../utils/logger";

const MCP_APPLICATION_NAME = "TomTom MCP Server";
const MCP_PRODUCTS = [
  { name: "AssetsAPI" },
  { name: "OnlineSearch" },
  { name: "OnlineGeocoding" },
  { name: "OnlineReverseGeocoding" },
  { name: "OnlineBatchSearch" },
  { name: "OnlineRouting" },
  { name: "MatrixRoutingV2" },
  { name: "WaypointOptimizationAPI" },
  { name: "calculateLongDistanceEVRoute" },
  { name: "OnlineMaps" },
  { name: "TrafficAPI" },
  { name: "OnlineChargingAvailability" },
  { name: "TomTom Geofencing API" },
  { name: "LocationHistoryAPI" },
  { name: "NotificationsAPI" },
  { name: "SnapToRoads" },
];

export interface GatewayApiKeyResolverConfig {
  /** Base URL for account/project endpoints (e.g. https://account.cx.tomtom.com) */
  accountApiBaseUrl: string;
  /** Base URL for APIM/application endpoints (e.g. https://apim.cx.tomtom.com) */
  apimApiBaseUrl: string;
}

interface Project {
  id: string;
  name?: string;
}

interface Credential {
  apiKey: string;
  status: boolean;
}

interface Application {
  id: string;
  name: string;
  displayName: string;
  credentials: Credential[];
  projectId: string;
}

/**
 * Resolves a TomTom API key by calling the CET gateway APIs (Connect-go protocol).
 *
 * Algorithm:
 * 1. List the user's projects, pick the first one
 * 2. List applications for that project
 * 3. Find an application with displayName "TomTom MCP Server", or create one
 * 4. Return the API key from its credentials
 */
export class GatewayApiKeyResolver {
  private readonly accountApiBaseUrl: string;
  private readonly apimApiBaseUrl: string;

  constructor(config: GatewayApiKeyResolverConfig) {
    this.accountApiBaseUrl = config.accountApiBaseUrl;
    this.apimApiBaseUrl = config.apimApiBaseUrl;
  }

  async resolveApiKey(accountToken: string, apimToken: string): Promise<string | null> {
    const projectId = await this.getProjectId(accountToken);
    if (projectId == null) {
      logger.warn("No projects found for user");
      return null;
    }

    const application = await this.findOrCreateMcpApplication(apimToken, projectId);
    if (application == null) {
      logger.error({ projectId }, "Failed to find or create MCP application");
      return null;
    }

    const activeCredential = application.credentials.find((c) => c.status);
    if (activeCredential == null) {
      logger.error({ applicationId: application.id }, "MCP application has no active credentials");
      return null;
    }

    return activeCredential.apiKey;
  }

  private async getProjectId(token: string): Promise<string | null> {
    const response = await this.connectRequest<{ projects: Project[] }>(
      token,
      this.accountApiBaseUrl,
      "/project.v2.ProjectService/ListProjects",
      {}
    );

    if (response.projects == null || response.projects.length === 0) {
      return null;
    }

    return response.projects[0].id;
  }

  private async findOrCreateMcpApplication(
    token: string,
    projectId: string
  ): Promise<Application | null> {
    const listResponse = await this.connectRequest<{ applications: Application[] }>(
      token,
      this.apimApiBaseUrl,
      "/apim.v1.ApplicationService/ListApplications",
      { project_id: projectId }
    );

    const existing = listResponse.applications?.find((app) => app.displayName === MCP_APPLICATION_NAME);
    if (existing != null) {
      logger.debug({ applicationId: existing.id }, "Found existing MCP application");
      // ListApplications returns masked keys, so fetch the full application to get unmasked keys.
      return this.getApplication(token, existing.id, projectId);
    }

    logger.info({ projectId }, "Creating new MCP application");
    const createResponse = await this.connectRequest<{ application: Application }>(
      token,
      this.apimApiBaseUrl,
      "/apim.v1.ApplicationService/CreateApplication",
      { name: MCP_APPLICATION_NAME, project_id: projectId, products: MCP_PRODUCTS }
    );

    return createResponse.application ?? null;
  }

  private async getApplication(
    token: string,
    applicationId: string,
    projectId: string
  ): Promise<Application | null> {
    const response = await this.connectRequest<{ application: Application }>(
      token,
      this.apimApiBaseUrl,
      "/apim.v1.ApplicationService/GetApplication",
      { application_id: applicationId, project_id: projectId }
    );

    return response.application ?? null;
  }

  private async connectRequest<T>(token: string, baseUrl: string, path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${baseUrl}${path}`;
    logger.debug({ url }, "Gateway API request");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new FaultError("Gateway API request failed", {
        status: response.status,
        url,
        responseBody,
      });
    }

    return (await response.json()) as T;
  }
}
