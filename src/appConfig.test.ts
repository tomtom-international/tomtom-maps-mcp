/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";
import { getAppConfig } from "./appConfig";

describe("getAppConfig", () => {
  it("defaults baseUrlPath to empty string when MCP_BASE_URL_PATH is unset", () => {
    const config = getAppConfig({ MCP_BASE_URL: "http://localhost:3000" });
    expect(config.baseUrlPath).toBe("");
    expect(`${config.baseUrl}${config.baseUrlPath}`).toBe("http://localhost:3000");
  });

  it("uses MCP_BASE_URL_PATH when provided", () => {
    const config = getAppConfig({
      MCP_BASE_URL: "https://mcp.tomtom.com",
      MCP_BASE_URL_PATH: "/maps",
    });
    expect(config.baseUrlPath).toBe("/maps");
    expect(`${config.baseUrl}${config.baseUrlPath}`).toBe("https://mcp.tomtom.com/maps");
  });

  it("produces the public resource identifier for prod-like env", () => {
    const config = getAppConfig({
      MCP_BASE_URL: "https://mcp.tomtom.com",
      MCP_BASE_URL_PATH: "/maps",
    });
    const resource = `${config.baseUrl}${config.baseUrlPath}`;
    expect(resource).toBe("https://mcp.tomtom.com/maps");
  });

  it("derives ulsClientId from the deployment's client metadata document URL", () => {
    const config = getAppConfig({
      MCP_BASE_URL: "https://mcp.tomtom.com",
      MCP_BASE_URL_PATH: "/maps",
    });
    expect(config.ulsClientId).toBe(
      "https://mcp.tomtom.com/.well-known/oauth-client-metadata/maps"
    );
  });

  it("strips a trailing slash from MCP_BASE_URL so derived identifiers have no double slash", () => {
    const config = getAppConfig({
      MCP_BASE_URL: "https://mcp.tomtom.com/",
      MCP_BASE_URL_PATH: "/maps",
    });
    expect(config.baseUrl).toBe("https://mcp.tomtom.com");
    expect(config.ulsClientId).toBe(
      "https://mcp.tomtom.com/.well-known/oauth-client-metadata/maps"
    );
  });

  it("prefers ULS_CLIENT_ID over the derived client metadata URL", () => {
    const config = getAppConfig({
      MCP_BASE_URL: "https://mcp.tomtom.com",
      MCP_BASE_URL_PATH: "/maps",
      ULS_CLIENT_ID: "https://legacy-client-id.example.com",
    });
    expect(config.ulsClientId).toBe("https://legacy-client-id.example.com");
  });

  it("disables the test authorize client unless the env var is exactly 'true'", () => {
    expect(getAppConfig({}).testAuthorizeClientEnabled).toBe(false);
    expect(getAppConfig({ TEST_AUTHORIZE_CLIENT_ENABLED: "1" }).testAuthorizeClientEnabled).toBe(
      false
    );
    expect(getAppConfig({ TEST_AUTHORIZE_CLIENT_ENABLED: "true" }).testAuthorizeClientEnabled).toBe(
      true
    );
  });
});
