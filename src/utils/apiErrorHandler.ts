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

/**
 * TomTom's reason for refusing a request, such as where to request private-preview access.
 * Undefined when the maps-sdk had only the status: "HTTP Error 403", or the status text.
 */
function refusalReason(errorDetails: unknown): string | undefined {
  if (typeof errorDetails !== "string") return undefined;
  const reason = errorDetails.trim();
  return /^(HTTP Error \d{3}|Unauthorized|Forbidden)?$/i.test(reason) ? undefined : reason;
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

  // 401: the API key is missing or not one TomTom knows
  if (statusCode === 401) {
    return new ForbiddenError(
      "TomTom rejected the API key as missing or invalid: check the server's TOMTOM_API_KEY or the request's tomtom-api-key header, or reconnect to sign in again",
      baseData
    );
  }

  // 403: TomTom accepted the key, but its account may not make this request
  if (statusCode === 403) {
    return new ForbiddenError(
      "TomTom refused this request for the account behind the API key: it has used up its free requests for this API, or its plan does not include this API. " +
        "Retrying will not help, so tell the user. Plans and free allowances: https://docs.tomtom.com/pricing",
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
 * Maps an HTTP error status from a URL the caller supplied, such as
 * tomtom-data-viz's data_url. The server behind it is not TomTom's, so unlike
 * fromApiStatus the messages name neither the TomTom API nor the API key.
 * @param status The HTTP status the URL answered with
 * @param cause The error the request failed with
 */
export function fromUrlStatus(status: number, cause: unknown): ErrorWithData {
  const data = { status };
  logger.error({ status_code: status }, "URL request failed with status code");

  if (status === 401 || status === 403) {
    return new ForbiddenError(
      "The URL's server refused access: the file must be publicly readable",
      data,
      { cause }
    );
  }
  if (status === 429) {
    return new BusyError("The URL's server is rate limiting requests", data, { cause });
  }
  if (status === 503) {
    return new UnavailableError("The URL's server is temporarily unavailable", data, { cause });
  }
  if (status >= 500 && status < 600) {
    return new FaultError("The URL's server encountered an internal error", data, { cause });
  }
  // Redirects are not followed, so a 3xx is the caller's to resolve like a 404
  return new IncorrectError("The URL returned an HTTP error", data, { cause });
}

/**
 * The JSON body a tool returns when it fails. For a caller error, the values
 * that were wrong ride along in details, since the message names none of them;
 * for a refused request, TomTom's reason does.
 */
export function toErrorPayload(error: Error): { error: string; details?: Record<string, unknown> } {
  if (error instanceof IncorrectError && Object.keys(error.data).length > 0) {
    return { error: error.message, details: error.data };
  }
  const reason =
    error instanceof ForbiddenError ? refusalReason(error.data.error_details) : undefined;
  if (reason) {
    return { error: error.message, details: { reason } };
  }
  return { error: error.message };
}
