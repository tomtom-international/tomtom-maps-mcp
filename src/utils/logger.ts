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

/**
 * Logger utility for the MCP server
 * Structured logging with Pino - JSON-RPC compatible
 * Outputs to stderr for clean separation from stdout
 * Supports both simple string messages and structured logging
 */

import pino from "pino";
import type { DestinationStream } from "pino";
import { appConfig } from "../appConfig";
import { ErrorWithData } from "../types/types";

export interface Logger {
  info: (msgOrData: string | object, msg?: string) => void;
  error: (msgOrData: string | object, msg?: string) => void;
  warn: (msgOrData: string | object, msg?: string) => void;
  debug: (msgOrData: string | object, msg?: string) => void;
}

/**
 * Creates a logger instance with the specified destination
 * @param options - Logger configuration options
 * @param options.destination - Optional destination stream, defaults to stderr
 * @param options.level - Optional log level, defaults to "info"
 */
export function makeLogger(
  options: { destination?: DestinationStream; level?: string } = {}
): Logger {
  const { destination, level = "info" } = options;

  const pinoInstance = pino(
    {
      level: level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    },
    destination ?? pino.destination({ dest: 2, sync: true }) // 2 = stderr
  );

  return {
    info: (msgOrData: string | object, msg?: string): void => {
      if (typeof msgOrData === "string") {
        pinoInstance.info(msgOrData);
      } else {
        // Embed in 'data' so fields from `msgOrData` don't conflict with standard top-level fields.
        pinoInstance.info({ data: msgOrData }, msg);
      }
    },

    error: (msgOrData: string | object, msg?: string): void => {
      if (typeof msgOrData === "string") {
        pinoInstance.error(msgOrData);
      } else {
        const record = msgOrData as Record<string, unknown>;
        const err = record.error;
        if (err !== undefined) {
          if (!(err instanceof ErrorWithData) && err instanceof Error) {
            record.error = err.message;
          } else {
            record.error = err;
          }
        }
        pinoInstance.error({ data: record }, msg);
      }
    },

    warn: (msgOrData: string | object, msg?: string): void => {
      if (typeof msgOrData === "string") {
        pinoInstance.warn(msgOrData);
      } else {
        // Embed in 'data' so fields from `msgOrData` don't conflict with standard top-level fields.
        pinoInstance.warn({ data: msgOrData }, msg);
      }
    },

    debug: (msgOrData: string | object, msg?: string): void => {
      if (typeof msgOrData === "string") {
        pinoInstance.debug(msgOrData);
      } else {
        // Embed in 'data' so fields from `msgOrData` don't conflict with standard top-level fields.
        pinoInstance.debug({ data: msgOrData }, msg);
      }
    },
  };
}

// Export default logger instance that writes to stderr
// Log level defaults to "info", or can be set via LOG_LEVEL environment variable
export const logger = makeLogger({ level: appConfig.logLevel });
