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

import type { SDKServiceError } from "@tomtom-org/maps-sdk/services";
import { logger } from "./logger";
import {
  UnavailableError,
  ErrorWithData,
  UnknownError,
  ForbiddenError,
  BusyError,
  FaultError,
  IncorrectError,
} from "../types/types";

/**
 * Handles errors from API calls, providing standardized error handling across services
 * @param error The error object from the API call
 * @param context Optional context description for logging
 * @returns A standardized error object
 */
export function handleApiError(error: unknown, context: string = "API call"): Error {
  // Pass through ErrorWithData subclasses unchanged
  if (error instanceof ErrorWithData) {
    return error;
  }

  if (error instanceof Error) {
    // The maps-sdk's SDKServiceError carries the status of a TomTom API error response
    const { status } = error as Partial<SDKServiceError>;
    if (typeof status === "number") return fromApiStatus(status, error.message, context);

    logger.error({ context, error: error.message }, "Request failed with unknown error");
    return new UnknownError(error.message, { context }, { cause: error });
  }

  const errorMessage = String(error);
  logger.error({ context, error: errorMessage }, "Request failed with unknown error");
  return new UnknownError("Unknown error", {
    context,
    error_value: errorMessage,
  });
}

function fromApiStatus(statusCode: number, errorMessage: string, context: string): Error {
  const baseData = {
    domain: "tomtom_api",
    status_code: statusCode,
    context,
    error_details: errorMessage,
  };

  logger.error(
    { context, status_code: statusCode, error: errorMessage },
    "Request failed with status code"
  );

  // 401/403: Authentication/Authorization errors
  if (statusCode === 401 || statusCode === 403) {
    return new ForbiddenError(
      "Your TomTom API key may be invalid, expired, or missing permissions for this request",
      baseData
    );
  }

  // 429: Rate limiting
  if (statusCode === 429) {
    return new BusyError("Rate limit exceeded: Too many requests to the TomTom API", baseData);
  }

  // 400: Bad request (incorrect input)
  if (statusCode === 400) {
    return new IncorrectError("Bad request to TomTom API", baseData);
  }

  // 503: Service unavailable
  if (statusCode === 503) {
    if (errorMessage.includes("no healthy upstream")) {
      return new UnavailableError(
        "TomTom service temporarily unavailable: This specific service is experiencing an outage",
        baseData
      );
    }
    return new UnavailableError(
      "TomTom service unavailable: The service might be temporarily down or undergoing maintenance",
      baseData
    );
  }

  // 5xx: Server errors
  if (statusCode >= 500 && statusCode < 600) {
    return new FaultError(
      "TomTom server error: The service encountered an internal error",
      baseData
    );
  }

  return new UnknownError("API error", baseData);
}

/**
 * The JSON body a tool returns when it fails. For a caller error, the values
 * that were wrong ride along in details, since the message names none of them.
 */
export function toErrorPayload(error: Error): { error: string; details?: Record<string, unknown> } {
  if (error instanceof IncorrectError && Object.keys(error.data).length > 0) {
    return { error: error.message, details: error.data };
  }
  return { error: error.message };
}
