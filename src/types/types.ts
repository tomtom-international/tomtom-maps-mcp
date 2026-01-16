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
import type { AxiosResponse } from "axios";

/**
 * TomTom API Error response format
 */
export interface TomTomErrorResponse {
  detailedError?: {
    code?: string;
    message?: string;
  };
  error?: string;
}

/**
 * Custom error class for TomTom API errors
 */
export class TomTomApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public response?: AxiosResponse<TomTomErrorResponse>
  ) {
    super(message);
    this.name = "TomTomApiError";

    // Ensures proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, TomTomApiError.prototype);
  }
}

/**
 * Custom error class with structured data
 */
export class ErrorInfo extends Error {
  public readonly data: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "ErrorInfo";
    this.data = data;

    // Ensures proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ErrorInfo.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      data: this.data,
      stack: this.stack,
      cause: this.cause
    };
  }
}

/**
 * Error category: The service is unavailable
 * Retrying is appropriate after ensuring the callee is healthy
 */
export class UnavailableError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "UnavailableError";
    Object.setPrototypeOf(this, UnavailableError.prototype);
  }
}

/**
 * Error category: An operation was interrupted
 * Stopping the interruption is needed
 */
export class InterruptedError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "InterruptedError";
    Object.setPrototypeOf(this, InterruptedError.prototype);
  }
}

/**
 * Error category: The system is busy/overloaded
 * Backing off and retrying is recommended
 */
export class BusyError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "BusyError";
    Object.setPrototypeOf(this, BusyError.prototype);
  }
}

/**
 * Error category: The caller sent incorrect/invalid information
 * The caller's code needs fixing (not retryable)
 */
export class IncorrectError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "IncorrectError";
    Object.setPrototypeOf(this, IncorrectError.prototype);
  }
}

/**
 * Error category: Access is forbidden
 * The caller needs proper credentials (not retryable)
 */
export class ForbiddenError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
 * Error category: The requested operation is not supported
 * The caller must use a different verb (not retryable)
 */
export class UnsupportedError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "UnsupportedError";
    Object.setPrototypeOf(this, UnsupportedError.prototype);
  }
}

/**
 * Error category: The requested resource was not found
 * The caller must reference a different noun (not retryable)
 */
export class NotFoundError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error category: Conflict with the callee's state
 * Coordination between systems is required (not retryable)
 */
export class ConflictError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error category: Internal fault on the callee side
 * Fixing the callee's bug may help (potentially retryable)
 */
export class FaultError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "FaultError";
    Object.setPrototypeOf(this, FaultError.prototype);
  }
}

/**
 * Error category: Unknown error type
 * May be retryable depending on the underlying cause
 */
export class UnknownError extends ErrorInfo {
  constructor(message: string, data: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, data, options);
    this.name = "UnknownError";
    Object.setPrototypeOf(this, UnknownError.prototype);
  }
}
