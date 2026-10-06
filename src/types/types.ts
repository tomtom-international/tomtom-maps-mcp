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
 * Type definitions for API errors
 */

/**
 * Custom error class with structured data. Subclasses name the error category;
 * `name` is the subclass name.
 */
export class ErrorWithData extends Error {
  public readonly data: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.data = data;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      data: this.data,
      stack: this.stack,
      cause: this.cause,
    };
  }
}

/** The service is unavailable: retry once the callee is healthy. */
export class UnavailableError extends ErrorWithData {}

/** An operation was interrupted: stop the interruption. */
export class InterruptedError extends ErrorWithData {}

/** The system is busy or overloaded: back off and retry. */
export class BusyError extends ErrorWithData {}

/** The caller sent incorrect information: the caller needs fixing (not retryable). */
export class IncorrectError extends ErrorWithData {}

/** Access is forbidden: the caller needs proper credentials (not retryable). */
export class ForbiddenError extends ErrorWithData {}

/** The operation is not supported: use a different verb (not retryable). */
export class UnsupportedError extends ErrorWithData {}

/** The resource was not found: reference a different noun (not retryable). */
export class NotFoundError extends ErrorWithData {}

/** Conflict with the callee's state: the systems need to coordinate (not retryable). */
export class ConflictError extends ErrorWithData {}

/** Internal fault on the callee side: fixing the callee may help (potentially retryable). */
export class FaultError extends ErrorWithData {}

/** Unknown error: may be retryable depending on the cause. */
export class UnknownError extends ErrorWithData {}
