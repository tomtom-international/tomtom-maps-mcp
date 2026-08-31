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
import { McpProjectResolver } from "./mcpProjectResolver";

const ACCOUNT_API = "https://account.test.example";
const TOKEN = "test-account-token";

const MCP_PRODUCT = { info: { code: "MCPServer", name: "MCP Server" } };
const OTHER_PRODUCT = { info: { code: "OnlineMaps", name: "Map Display API" } };

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

function stubAccountApi(projects: MockProject[]) {
  const getProjectBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(ACCOUNT_API, "");
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (path === "/project.v2.ProjectService/ListProjects") {
        return jsonResponse({ projects: projects.map(({ id }) => ({ id })) });
      }
      if (path === "/project.v2.ProjectService/GetProject") {
        getProjectBodies.push(body);
        const project = projects.find((p) => p.id === body.id);
        if (project == null) return jsonResponse({ code: "not_found" }, 404);
        if (project.errorStatus != null) {
          return jsonResponse(
            { code: "permission_denied", message: "permission denied" },
            project.errorStatus
          );
        }
        return jsonResponse({ project: { id: project.id, bundles: project.bundles } });
      }
      return jsonResponse({ code: "not_found" }, 404);
    })
  );
  return getProjectBodies;
}

describe("McpProjectResolver", () => {
  const resolver = new McpProjectResolver({ accountApiBaseUrl: ACCOUNT_API });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the first project whose active bundle contains the MCPServer product", async () => {
    stubAccountApi([
      { id: "project-1", bundles: [mcpBundle("bundle-1", { products: [OTHER_PRODUCT] })] },
      { id: "project-2", bundles: [mcpBundle("bundle-2")] },
      { id: "project-3", bundles: [mcpBundle("bundle-3")] },
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
      projectId: "project-2",
      bundleId: "bundle-2",
    });
  });

  it("requests projects with with_products so bundles are populated", async () => {
    const getProjectBodies = stubAccountApi([
      { id: "project-1", bundles: [mcpBundle("bundle-1")] },
    ]);

    await resolver.resolveMcpProject(TOKEN);

    expect(getProjectBodies).toEqual([{ id: "project-1", with_products: true }]);
  });

  it("ignores inactive bundles even when they contain the MCPServer product", async () => {
    stubAccountApi([{ id: "project-1", bundles: [mcpBundle("bundle-1", { isActive: false })] }]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("returns null when no bundle contains the MCPServer product", async () => {
    stubAccountApi([
      { id: "project-1", bundles: [mcpBundle("bundle-1", { products: [OTHER_PRODUCT] })] },
      { id: "project-2", bundles: [] },
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("returns null when the user has no projects", async () => {
    stubAccountApi([]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toBeNull();
  });

  it("skips projects that fail to load instead of throwing", async () => {
    stubAccountApi([
      { id: "project-1", errorStatus: 403 },
      { id: "project-2", bundles: [mcpBundle("bundle-2")] },
    ]);

    await expect(resolver.resolveMcpProject(TOKEN)).resolves.toEqual({
      projectId: "project-2",
      bundleId: "bundle-2",
    });
  });
});
