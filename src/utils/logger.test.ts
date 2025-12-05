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

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Save the original console.error method
const originalConsoleError = console.error;

// Set up mock for console.error before importing the module
console.error = vi.fn();

// Now import the logger
import { logger } from "./logger";

describe("Logger", () => {
  beforeEach(() => {
    // Clear mocks before each test
    (console.error as any).mockClear();
  });

  afterAll(() => {
    // Restore original console method after all tests
    console.error = originalConsoleError;
  });

  it("should log errors with timestamp and ERROR level", () => {
    logger.error("Test error message");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\]: Test error message/
      )
    );
  });

  it("should log warnings with timestamp and WARN level", () => {
    logger.warn("Test warning message");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[WARN\]: Test warning message/
      )
    );
  });

  it("should log info with timestamp and INFO level", () => {
    logger.info("Test info message");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\]: Test info message/
      )
    );
  });

  it("should log debug with timestamp and DEBUG level", () => {
    logger.debug("Test debug message");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\]: Test debug message/
      )
    );
  });

  it("should format log output correctly", () => {
    logger.info("Test formatted message");

    // Verify error was called with the message
    expect((console.error as any).mock.calls.length).toBeGreaterThan(0);
    const logCall = (console.error as any).mock.calls[0][0];

    // Check format: [timestamp] [LEVEL]: message
    expect(logCall).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\]: Test formatted message$/
    );
  });
});
