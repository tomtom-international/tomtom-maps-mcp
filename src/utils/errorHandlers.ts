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

import { logger as defaultLogger } from "./logger";

/**
 * Registers global error handlers for uncaught exceptions and unhandled promise rejections.
 * These handlers log the errors and terminate the process with exit code 1.
 */
export function registerErrorHandlers(
  processInstance: NodeJS.Process = process,
  logger: typeof defaultLogger = defaultLogger
): void {
  processInstance.on("uncaughtException", (error: Error) => {
    logger.error(
      { error: error.message, stack: error.stack },
      "Uncaught Exception"
    );
    processInstance.exit(1);
  });

  processInstance.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    logger.error(
      {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise),
      },
      "Unhandled Promise Rejection"
    );
    processInstance.exit(1);
  });
}
