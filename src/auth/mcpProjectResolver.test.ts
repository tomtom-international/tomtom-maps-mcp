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

import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger";
import { McpProjectResolver } from "./mcpProjectResolver";

const ACCOUNT_API = "https://account.test.example";
const LIST_PROJECTS = "/project.v2.ProjectService/ListProjects";
const GET_PROJECT = "/project.v2.ProjectService/GetProject";
const TOKEN = "test-account-token";

const MCP_PRODUCT = { info: { code: "MCPServer", name: "MCP Server" } };
const OTHER_PRODUCT = { info: { code: "OnlineMaps", name: "Map Display API" } };

const UNAVAILABLE = {
  status: 503,
  body: {
    code: "unavailable",
    message: "project permissions temporarily unavailable",
    details: [{ type: "errdetails.v1.RequestInfo", debug: { requestId: "acct-req-123" } }],
  },
};
const FORBIDDEN = {
  status: 403,
  body: { code: "permission_denied", message: "permission denied" },
};

function mcpBundle(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Test Bundle",
    type: "BUNDLE_TYPE_GENERIC",
    isActive: true,
    status: "BUNDLE_STATUS_ACTIVE",
    products: [OTHER_PRODUCT, MCP_PRODUCT],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MockProject {
  id: string;
  bundles?: unknown[];
  errorStatus?: number;
}

interface StubOptions {
  /** Error responses served to the first ListProjects calls, before any page is served */
  listErrors?: Array<{ status: number; body: unknown }>;
}

/**
 * Stubs the account API. `pages` are served in order; every page except the last carries a
 * nextPageToken, and the request body of each ListProjects/GetProject call is recorded.
 */
function listProjectsResponse(pages: MockProject[][], body: Record<string, unknown>): Response {
  const pageIndex =
    body.page_token == null ? 0 : Number(String(body.page_token).replace("page-", ""));
  const page = pages[pageIndex] ?? [];
  const hasMore = pageIndex < pages.length - 1;
  return jsonResponse({
    projects: page.map(({ id }) => ({ id })),
    ...(hasMore && { nextPageToken: `page-${pageIndex + 1}` }),
  });
}

function getProjectResponse(projects: MockProject[], body: Record<string, unknown>): Response {
  const project = projects.find((p) => p.id === body.id);
  if (project == null) return jsonResponse({ code: "not_found" }, 404);
  if (project.errorStatus != null) return jsonResponse(FORBIDDEN.body, project.errorStatus);
  return jsonResponse({ project: { id: project.id, bundles: project.bundles } });
}

function stubAccountApi(pages: MockProject[][], options: StubOptions = {}) {
  const listErrors = [...(options.listErrors ?? [])];
  const listBodies: Array<Record<string, unknown>> = [];
  const getProjectBodies: Array<Record<string, unknown>> = [];
  const allProjects = pages.flat();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(ACCOUNT_API, "");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      if (path === LIST_PROJECTS) {
        listBodies.push(body);
        const error = listErrors.shift();
        return error != null
          ? jsonResponse(error.body, error.status)
          : listProjectsResponse(pages, body);
      }
      if (path === GET_PROJECT) {
        getProjectBodies.push(body);
        return getProjectResponse(allProjects, body);
      }
      return jsonResponse({ code: "not_found" }, 404);
    })
  );

  return { listBodies, getProjectBodies };
}

describe("McpProjectResolver", () => {
  const resolver = new McpProjectResolver({ accountApiBaseUrl: ACCOUNT_API, retryDelayMs: 0 });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the first project whose active bundle contains the MCPServer product", async () => {
    stubAccountApi([
      [
        { id: "project-1", bundles: [mcpBundle("bundle-1", { products: [OTHER_PRODUCT] })] },
        { id: "project-2", bundles: [mcpBundle("bundle-2")] },
        { id: "project-3", bundles: [mcpBundle("bundle-3")] },
      ],
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
      projectId: "project-2",
      bundleId: "bundle-2",
    });
  });

  it("requests projects with with_products so bundles are populated", async () => {
    const { getProjectBodies } = stubAccountApi([
      [{ id: "project-1", bundles: [mcpBundle("bundle-1")] }],
    ]);

    await resolver.resolveMcpProject(TOKEN);

    expect(getProjectBodies).toEqual([{ id: "project-1", with_products: true }]);
  });

  it("ignores inactive bundles even when they contain the MCPServer product", async () => {
    stubAccountApi([[{ id: "project-1", bundles: [mcpBundle("bundle-1", { isActive: false })] }]]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("returns null when no bundle contains the MCPServer product", async () => {
    stubAccountApi([
      [
        { id: "project-1", bundles: [mcpBundle("bundle-1", { products: [OTHER_PRODUCT] })] },
        { id: "project-2", bundles: [] },
      ],
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("returns null when the user has no projects", async () => {
    stubAccountApi([[]]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("skips projects that fail to load instead of throwing", async () => {
    stubAccountApi([
      [
        { id: "project-1", errorStatus: 403 },
        { id: "project-2", bundles: [mcpBundle("bundle-2")] },
      ],
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
      projectId: "project-2",
      bundleId: "bundle-2",
    });
  });

  describe("pagination", () => {
    it("requests a bounded page and follows nextPageToken only until a match is found", async () => {
      const { listBodies } = stubAccountApi([
        [{ id: "project-1", bundles: [mcpBundle("bundle-1", { products: [OTHER_PRODUCT] })] }],
        [{ id: "project-2", bundles: [mcpBundle("bundle-2")] }],
        [{ id: "project-3", bundles: [mcpBundle("bundle-3")] }],
      ]);

      await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
        projectId: "project-2",
        bundleId: "bundle-2",
      });
      expect(listBodies).toEqual([{ page_size: 10 }, { page_size: 10, page_token: "page-1" }]);
    });

    it("continues past an empty page while a nextPageToken is present", async () => {
      const { listBodies } = stubAccountApi([
        [],
        [{ id: "project-1", bundles: [mcpBundle("bundle-1")] }],
      ]);

      await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
        projectId: "project-1",
        bundleId: "bundle-1",
      });
      expect(listBodies).toHaveLength(2);
    });
  });

  describe("retry", () => {
    it("retries once when the account API reports itself unavailable", async () => {
      const { listBodies } = stubAccountApi(
        [[{ id: "project-1", bundles: [mcpBundle("bundle-1")] }]],
        {
          listErrors: [UNAVAILABLE],
        }
      );

      await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
        projectId: "project-1",
        bundleId: "bundle-1",
      });
      expect(listBodies).toHaveLength(2);
    });

    it("gives up after a single retry", async () => {
      const { listBodies } = stubAccountApi(
        [[{ id: "project-1", bundles: [mcpBundle("bundle-1")] }]],
        {
          listErrors: [UNAVAILABLE, UNAVAILABLE],
        }
      );

      await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
      expect(listBodies).toHaveLength(2);
    });

    it("does not retry final errors", async () => {
      const { listBodies } = stubAccountApi(
        [[{ id: "project-1", bundles: [mcpBundle("bundle-1")] }]],
        {
          listErrors: [FORBIDDEN],
        }
      );

      await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
      expect(listBodies).toHaveLength(1);
    });
  });

  describe("logging", () => {
    it("logs the account API request id and our request id on failure", async () => {
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      stubAccountApi([[]], { listErrors: [UNAVAILABLE, UNAVAILABLE] });

      await resolver.resolveMcpProject(TOKEN, "mcp-req-abc");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "mcp-req-abc",
          code: "unavailable",
          upstreamRequestId: "acct-req-123",
          willRetry: true,
        }),
        "Account API request failed"
      );
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestId: "mcp-req-abc", willRetry: false }),
        "Account API request failed"
      );
    });

    it("distinguishes a failed lookup from a user with no projects", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      stubAccountApi([[]], { listErrors: [FORBIDDEN] });
      await resolver.resolveMcpProject(TOKEN, "req-1");
      expect(warnSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "Project lookup failed for user"
      );

      stubAccountApi([[]]);
      await resolver.resolveMcpProject(TOKEN, "req-2");
      expect(warnSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestId: "req-2" }),
        "No projects found for user"
      );
    });
  });
});
