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
import { adoptRequestId, runWithLogContext } from "./logContext";
import { logger } from "./utils/logger";

export type AuthMethod = "tomtom-api-key" | "oauth";

export interface McpRequestLog {
  method?: string;
  client: string;
  clientVersion?: string;
  apps: ClientApps;
  appsChosen: boolean;
  auth: AuthMethod;
}

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      mcpRequest?: McpRequestLog;
    }
  }
}

export function logRequests(sessionHashSecret: string | undefined): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    const requestId = adoptRequestId(req.header("x-request-id"));
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const session = sessionKey(
      req.header("mcp-session-id") ?? req.header("x-openai-session"),
      sessionHashSecret
    );
    runWithLogContext({ requestId, session }, () => {
      res.on(
        "close",
        AsyncResource.bind(() =>
          logger.info(
            {
              path: req.path,
              ...res.locals.mcpRequest,
              status: res.statusCode,
              durationMs: Math.round(performance.now() - started),
            },
            "Request completed"
          )
        )
      );
      next();
    });
  };
}
