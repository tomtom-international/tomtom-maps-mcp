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

/** Product code marking a bundle as MCP-enabled (bundle type is BUNDLE_TYPE_GENERIC either way) */
const MCP_PRODUCT_CODE = "MCPServer";

export interface McpProjectResolverConfig {
  /** Base URL for account/project endpoints (e.g. https://account.cx.tomtom.com) */
  accountApiBaseUrl: string;
}

export interface McpProject {
  projectId: string;
  bundleId: string;
}

interface ProjectSummary {
  id: string;
  name?: string;
}

interface BundleProduct {
  info?: {
    code?: string;
    name?: string;
  };
}

interface Bundle {
  id: string;
  name?: string;
  type?: string;
  isActive?: boolean;
  status?: string;
  products?: BundleProduct[];
}

interface ProjectDetail {
  id: string;
  bundles?: Bundle[];
}

/**
 * Finds the user's project whose bundle contains the MCP Server product, using
 * the account gateway (Connect-go protocol):
 * 1. ListProjects — returns project summaries only (project.v3.Summary has no bundles)
 * 2. GetProject with with_products — populates project.bundles[].products
 *
 * The first project (in ListProjects order) with an active MCP-enabled bundle wins.
 */
export class McpProjectResolver {
  private readonly accountApiBaseUrl: string;

  constructor(config: McpProjectResolverConfig) {
    this.accountApiBaseUrl = config.accountApiBaseUrl;
  }

  async resolveMcpProject(accountToken: string): Promise<McpProject | null> {
    const projects = await this.listProjects(accountToken);
    if (projects == null || projects.length === 0) {
      logger.warn("No projects found for user");
      return null;
    }

    for (const projectSummary of projects) {
      const project = await this.getProjectWithProducts(accountToken, projectSummary.id);
      const mcpBundle = project?.bundles?.find(
        (bundle) =>
          bundle.isActive &&
          bundle.products?.some((product) => product.info?.code === MCP_PRODUCT_CODE)
      );
      if (mcpBundle != null) {
        logger.debug(
          { projectId: projectSummary.id, bundleId: mcpBundle.id },
          "Resolved MCP project and bundle"
        );
        return { projectId: projectSummary.id, bundleId: mcpBundle.id };
      }
    }

    logger.warn({ projectCount: projects.length }, "No project with an MCP bundle found for user");
    return null;
  }

  private async listProjects(token: string): Promise<ProjectSummary[] | null> {
    const response = await this.connectRequest<{ projects?: ProjectSummary[] }>(
      token,
      "/project.v3.ProjectService/ListProjects",
      {}
    );
    return response?.projects ?? null;
  }

  private async getProjectWithProducts(
    token: string,
    projectId: string
  ): Promise<ProjectDetail | null> {
    const response = await this.connectRequest<{ project?: ProjectDetail }>(
      token,
      "/project.v3.ProjectService/GetProject",
      { id: projectId, with_products: true }
    );
    return response?.project ?? null;
  }

  private async connectRequest<T>(
    token: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<T | null> {
    const url = `${this.accountApiBaseUrl}${path}`;
    logger.debug({ url }, "Account API request");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      logger.error(
        { status: response.status, url, code: errorBody?.code, message: errorBody?.message },
        "Account API request failed"
      );
      return null;
    }

    return (await response.json()) as T;
  }
}
