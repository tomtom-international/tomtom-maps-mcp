/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import { AsyncResource } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { ClientApps } from "./clientApps";
import { sessionKey } from "./clientSession";
import { adoptRequestId, RequestContextHolder } from "./requestContextHolder";
import { logger } from "./utils/logger";

export type AuthMethod = "tomtom-api-key" | "oauth";

interface McpRequestLog {
  method?: string;
  clientVersion?: string;
  apps: ClientApps;
  appsChosen: boolean;
  auth: AuthMethod;
}

declare global {
  namespace Express {
    interface Locals {
      mcpRequest?: McpRequestLog;
    }
  }
}

export function logRequests(sessionHashSecret: string | undefined): RequestHandler {
  return (request, response, next) => {
    const started = performance.now();
    const requestId = adoptRequestId(request.header("x-request-id"));
    response.setHeader("X-Request-Id", requestId);
    const session = sessionKey(
      request.header("mcp-session-id") ?? request.header("x-openai-session"),
      sessionHashSecret
    );
    RequestContextHolder.run(
      { requestId, session, user_agent: request.header("user-agent") },
      () => {
        response.on(
          "close",
          AsyncResource.bind(() =>
            logger.info(
              {
                path: request.path,
                ...response.locals.mcpRequest,
                status: response.statusCode,
                durationMs: Math.round(performance.now() - started),
              },
              "Request completed"
            )
          )
        );
        next();
      }
    );
  };
}
