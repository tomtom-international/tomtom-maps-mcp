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

import { describe, it, expect, beforeEach } from "vitest";
import { Writable } from "stream";
import { makeLogger, type Logger } from "./logger";
import { FaultError, UnavailableError } from "../types/types";

describe("Logger", () => {
  type LogEntry = { level: string; msg: string; time: string; data?: { [key: string]: unknown } };
  let logs: LogEntry[];
  let logger: Logger;

  beforeEach(() => {
    // Reset logs array before each test
    logs = [];

    // Create an in-memory stream that captures logs
    const memoryStream = new Writable({
      write(chunk, encoding, callback) {
        logs.push(JSON.parse(chunk.toString()));
        callback();
      },
    });

    // Create logger with memory stream, explicitly set to info level
    logger = makeLogger({ destination: memoryStream, level: "info" });
  });

  it("should log errors with timestamp and ERROR level", () => {
    logger.error("Test error message");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].msg).toBe("Test error message");
    expect(logs[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should log warnings with timestamp and WARN level", () => {
    logger.warn("Test warning message");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("warn");
    expect(logs[0].msg).toBe("Test warning message");
    expect(logs[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should log info with timestamp and INFO level", () => {
    logger.info("Test info message");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].msg).toBe("Test info message");
    expect(logs[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should not log debug messages when level is set to info", () => {
    logger.debug("This debug message should not be logged");

    expect(logs).toHaveLength(0);
  });

  it("should log debug with timestamp and DEBUG level when level is set to debug", () => {
    // Create a logger with debug level enabled
    const memoryStream = new Writable({
      write(chunk, encoding, callback) {
        logs.push(JSON.parse(chunk.toString()));
        callback();
      },
    });
    const debugLogger = makeLogger({ destination: memoryStream, level: "debug" });

    debugLogger.debug("Test debug message");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("debug");
    expect(logs[0].msg).toBe("Test debug message");
    expect(logs[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should support structured logging with data objects", () => {
    logger.info({ userId: 123, action: "login" }, "User logged in");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].msg).toBe("User logged in");
    expect(logs[0].data!.userId).toBe(123);
    expect(logs[0].data!.action).toBe("login");
  });

  it("should serialize an ErrorWithData subclass to its data when logging errors with an object", () => {
    const root_error = new FaultError("root cause", { detail: "internal" });
    const error = new UnavailableError("something broke", { statusCode: 500, endpoint: "/api/test" }, { cause: root_error });
    logger.error({ error }, "Request failed");

    const error_log = logs[0].data!.error as Record<string, unknown>;
    expect(error_log).toEqual(
      expect.objectContaining({
        name: "UnavailableError",
        message: "something broke",
        data: { statusCode: 500, endpoint: "/api/test" },
      }),
    );
    expect(error_log).toHaveProperty("stack");
    const cause = error_log.cause as Record<string, unknown>;
    expect(cause).toEqual(
      expect.objectContaining({
        name: "FaultError",
        message: "root cause",
        data: { detail: "internal" },
      }),
    );
    expect(cause).toHaveProperty("stack");
  });

  it("should serialize a plain Error to its message when logging errors with an object", () => {
    const error = new Error("connection refused");
    logger.error({ error, host: "localhost" }, "Connection error");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].msg).toBe("Connection error");
    expect(logs[0].data!.error).toBe("connection refused");
    expect(logs[0].data!.host).toBe("localhost");
  });

  it("should pass through non-Error error values as-is when logging errors with an object", () => {
    logger.error({ error: { code: "TIMEOUT" } }, "Unexpected error type");

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].msg).toBe("Unexpected error type");
    expect(logs[0].data!.error).toEqual({ code: "TIMEOUT" });
  });

  it("should log multiple messages in order", () => {
    logger.info("First message");
    logger.warn("Second message");
    logger.error("Third message");

    expect(logs).toHaveLength(3);
    expect(logs[0].msg).toBe("First message");
    expect(logs[0].level).toBe("info");
    expect(logs[1].msg).toBe("Second message");
    expect(logs[1].level).toBe("warn");
    expect(logs[2].msg).toBe("Third message");
    expect(logs[2].level).toBe("error");
  });
});
