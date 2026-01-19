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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { registerErrorHandlers } from "./uncaughtErrorHandlers";
import type { Logger } from "./logger";

describe("registerErrorHandlers", () => {
  let mockProcess: EventEmitter & { exit: ReturnType<typeof vi.fn> };
  let mockLogger: Logger;

  beforeEach(() => {
    // Create a mock process object that extends EventEmitter
    mockProcess = Object.assign(new EventEmitter(), {
      exit: vi.fn(),
    }) as EventEmitter & { exit: ReturnType<typeof vi.fn> };

    // Create a mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  it("should log uncaught exceptions and exit with code 1", () => {
    registerErrorHandlers(mockProcess as any, mockLogger);

    const testError = new Error("Test uncaught exception");
    mockProcess.emit("uncaughtException", testError);

    expect(mockLogger.error).toHaveBeenCalledWith(
      { error: "Test uncaught exception", stack: expect.any(String) },
      "Uncaught Exception"
    );
    expect(mockProcess.exit).toHaveBeenCalledWith(1);
  });

  it("should log unhandled rejections with Error reason and exit with code 1", () => {
    registerErrorHandlers(mockProcess as any, mockLogger);

    const testError = new Error("Test unhandled rejection");
    const testPromise = Promise.reject(testError);
    // Catch the rejection to prevent it from propagating to the test runner
    testPromise.catch(() => {});
    mockProcess.emit("unhandledRejection", testError, testPromise);

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        reason: "Test unhandled rejection",
        stack: expect.any(String),
        promise: expect.stringContaining("Promise"),
      },
      "Unhandled Promise Rejection"
    );
    expect(mockProcess.exit).toHaveBeenCalledWith(1);
  });

  it("should log unhandled rejections with non-Error reason and exit with code 1", () => {
    registerErrorHandlers(mockProcess as any, mockLogger);

    const testReason = "String rejection reason";
    const testPromise = Promise.reject(testReason);
    // Catch the rejection to prevent it from propagating to the test runner
    testPromise.catch(() => {});
    mockProcess.emit("unhandledRejection", testReason, testPromise);

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        reason: "String rejection reason",
        stack: undefined,
        promise: expect.stringContaining("Promise"),
      },
      "Unhandled Promise Rejection"
    );
    expect(mockProcess.exit).toHaveBeenCalledWith(1);
  });

  it("should register handlers on the provided process instance", () => {
    registerErrorHandlers(mockProcess as any, mockLogger);

    expect(mockProcess.listenerCount("uncaughtException")).toBe(1);
    expect(mockProcess.listenerCount("unhandledRejection")).toBe(1);
  });
});
