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

const LIST_PROJECTS_PATH = "/project.v2.ProjectService/ListProjects";
const GET_PROJECT_PATH = "/project.v2.ProjectService/GetProject";

/** Projects per ListProjects page; also bounds the account API's per-page OpenFGA permission check. */
const PROJECTS_PAGE_SIZE = 10;
const DEFAULT_RETRY_DELAY_MS = 200;

export interface McpProjectResolverConfig {
  /** Base URL for account/project endpoints (e.g. https://account.cx.tomtom.com) */
  accountApiBaseUrl: string;
  /** Delay before the single retry of a request the account API reported as transiently unavailable */
  retryDelayMs?: number;
}

export interface McpProject {
  projectId: string;
  bundleId: string;
}

interface ProjectSummary {
  id: string;
  name?: string;
}

interface ProjectsPage {
  projects?: ProjectSummary[];
  nextPageToken?: string;
}

interface BundleProduct {
  info?: {
    code?: string;
    name?: string;
  };
}

type BundleType =
  | "BUNDLE_TYPE_UNSPECIFIED"
  | "BUNDLE_TYPE_GENERIC"
  | "BUNDLE_TYPE_SDK"
  | "BUNDLE_TYPE_FEATURE";

type BundleStatus = "BUNDLE_STATUS_UNSPECIFIED" | "BUNDLE_STATUS_ACTIVE" | "BUNDLE_STATUS_INACTIVE";

interface Bundle {
  id: string;
  name?: string;
  type?: BundleType;
  /** Whether the bundle is currently active; only active bundles are treated as a match. */
  isActive?: boolean;
  status?: BundleStatus;
  products?: BundleProduct[];
}

interface ProjectDetail {
  id: string;
  bundles?: Bundle[];
}

interface ConnectError {
  code?: string;
  message?: string;
  details?: Array<{ type?: string; debug?: { requestId?: string } }>;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; retryable: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upstreamRequestId(error: ConnectError | null): string | undefined {
  return error?.details?.find((detail) => detail.debug?.requestId != null)?.debug?.requestId;
}

/**
 * Finds the user's project whose bundle contains the MCP Server product, using
 * the account gateway (Connect-go protocol):
 * 1. ListProjects, page by page — returns project summaries only (project.v2.Summary has no bundles)
 * 2. GetProject with with_products — populates project.bundles[].products
 *
 * The first project (in ListProjects order) with an active MCP-enabled bundle wins,
 * so later pages are only fetched while no match has been found.
 */
export class McpProjectResolver {
  private readonly accountApiBaseUrl: string;
  private readonly retryDelayMs: number;

  constructor(config: McpProjectResolverConfig) {
    this.accountApiBaseUrl = config.accountApiBaseUrl;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async resolveMcpProject(accountToken: string, requestId?: string): Promise<McpProject | null> {
    let pageToken: string | undefined;
    let projectCount = 0;

    do {
      const page = await this.listProjectsPage(accountToken, pageToken, requestId);
      if (page == null) {
        logger.warn({ requestId, projectCount }, "Project lookup failed for user");
        return null;
      }

      const projects = page.projects ?? [];
      projectCount += projects.length;

      for (const summary of projects) {
        const mcpBundle = await this.findMcpBundle(accountToken, summary.id, requestId);
        if (mcpBundle != null) {
          logger.debug(
            { requestId, projectId: summary.id, bundleId: mcpBundle.id },
            "Resolved MCP project and bundle"
          );
          return { projectId: summary.id, bundleId: mcpBundle.id };
        }
      }

      // The account API drops rows that fail its permission check after fetching a page,
      // so a short or even empty page is not the last one; only the token says so.
      pageToken = page.nextPageToken || undefined;
    } while (pageToken != null);

    if (projectCount === 0) {
      logger.warn({ requestId }, "No projects found for user");
    } else {
      logger.warn({ requestId, projectCount }, "No project with an MCP bundle found for user");
    }
    return null;
  }

  private async listProjectsPage(
    token: string,
    pageToken: string | undefined,
    requestId?: string
  ): Promise<ProjectsPage | null> {
    return this.connectRequest<ProjectsPage>(
      token,
      LIST_PROJECTS_PATH,
      { page_size: PROJECTS_PAGE_SIZE, ...(pageToken != null && { page_token: pageToken }) },
      requestId
    );
  }

  private async findMcpBundle(
    token: string,
    projectId: string,
    requestId?: string
  ): Promise<Bundle | null> {
    const response = await this.connectRequest<{ project?: ProjectDetail }>(
      token,
      GET_PROJECT_PATH,
      { id: projectId, with_products: true },
      requestId
    );
    return (
      response?.project?.bundles?.find(
        (bundle) =>
          bundle.isActive &&
          bundle.products?.some((product) => product.info?.code === MCP_PRODUCT_CODE)
      ) ?? null
    );
  }

  private async connectRequest<T>(
    token: string,
    path: string,
    body: Record<string, unknown>,
    requestId?: string
  ): Promise<T | null> {
    const url = `${this.accountApiBaseUrl}${path}`;

    let attempt = await this.send<T>(url, token, body, requestId, false);
    if (!attempt.ok && attempt.retryable) {
      await sleep(this.retryDelayMs);
      attempt = await this.send<T>(url, token, body, requestId, true);
    }
    return attempt.ok ? attempt.value : null;
  }

  private async send<T>(
    url: string,
    token: string,
    body: Record<string, unknown>,
    requestId: string | undefined,
    isRetry: boolean
  ): Promise<Attempt<T>> {
    logger.debug({ requestId, url, isRetry }, "Account API request");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return { ok: true, value: (await response.json()) as T };
    }

    const error = (await response.json().catch(() => null)) as ConnectError | null;
    // The account API classifies its OpenFGA permission-check deadlines as `unavailable`
    // and retryable; everything else (auth, not found, validation) is final.
    const retryable = (response.status === 503 || error?.code === "unavailable") && !isRetry;
    logger.error(
      {
        requestId,
        url,
        status: response.status,
        code: error?.code,
        message: error?.message,
        upstreamRequestId: upstreamRequestId(error),
        willRetry: retryable,
      },
      "Account API request failed"
    );
    return { ok: false, retryable };
  }
}
