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
});
