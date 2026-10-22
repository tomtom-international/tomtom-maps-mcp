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
  NotFoundError,
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

/** The error classes an HTTP status implies whichever server answered it. */
const statusErrorClasses = {
  unauthorized: ForbiddenError,
  forbidden: ForbiddenError,
  busy: BusyError,
  unavailable: UnavailableError,
  fault: FaultError,
};

type StatusErrorKind = keyof typeof statusErrorClasses;

/** Undefined for a status whose meaning depends on the server, which its caller maps itself. */
function errorKindForStatus(status: number): StatusErrorKind | undefined {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "busy";
  if (status === 503) return "unavailable";
  if (status >= 500 && status < 600) return "fault";
  return undefined;
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

  const kind = errorKindForStatus(statusCode);
  if (kind) {
    const messages: Record<StatusErrorKind, string> = {
      unauthorized:
        "TomTom rejected the API key as missing or invalid: check the server's TOMTOM_API_KEY or the request's tomtom-api-key header, or reconnect to sign in again",
      forbidden:
        "TomTom refused this request for the account behind the API key: it has used up its free requests for this API, or its plan does not include this API. " +
        "Retrying will not help, so tell the user. Plans and free allowances: https://docs.tomtom.com/pricing",
      busy: "Rate limit exceeded: Too many requests to the TomTom API",
      unavailable: errorMessage.includes("no healthy upstream")
        ? "TomTom service temporarily unavailable: This specific service is experiencing an outage"
        : "TomTom service unavailable: The service might be temporarily down or undergoing maintenance",
      fault: "TomTom server error: The service encountered an internal error",
    };
    return new statusErrorClasses[kind](messages[kind], baseData);
  }

  if (statusCode === 400) {
    return new IncorrectError("Bad request to TomTom API", baseData);
  }

  return new UnknownError("API error", baseData);
}

const urlRefusedMessage = "The URL's server refused access: the file must be publicly readable";

const urlStatusMessages: Record<StatusErrorKind, string> = {
  unauthorized: urlRefusedMessage,
  forbidden: urlRefusedMessage,
  busy: "The URL's server is rate limiting requests",
  unavailable: "The URL's server is temporarily unavailable",
  fault: "The URL's server encountered an internal error",
};

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

  const kind = errorKindForStatus(status);
  if (kind) {
    return new statusErrorClasses[kind](urlStatusMessages[kind], data, { cause });
  }
  if (status === 404 || status === 410) {
    return new NotFoundError("The URL's server has no file at that address", data, { cause });
  }
  // Redirects are not followed, so a 3xx is the caller's to resolve
  return new IncorrectError("The URL returned an HTTP error", data, { cause });
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
