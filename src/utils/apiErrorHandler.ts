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

import {
  BusyError,
  type ErrorKind,
  ErrorWithData,
  FaultError,
  ForbiddenError,
  IncorrectError,
  InterruptedError,
  UnavailableError,
  UnknownError,
} from "../types/types";
import { logger } from "./logger";

export const REQUEST_FAILED_MESSAGE = "The request failed: retry, or tell the user.";

export function handleApiError(error: unknown): ErrorWithData {
  if (error instanceof ErrorWithData) return error;
  return new UnknownError(REQUEST_FAILED_MESSAGE, {}, { cause: error });
}

export function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return ForbiddenError;
  if (status === 429) return BusyError;
  if (status === 503) return UnavailableError;
  if (status >= 500) return FaultError;
  return UnknownError;
}

const URL_MESSAGE_BY_KIND = new Map<ErrorKind, string>([
  [ForbiddenError, "The URL's server refused access: the file must be publicly readable"],
  [BusyError, "The URL's server is rate limiting requests"],
  [UnavailableError, "The URL's server is temporarily unavailable"],
  [FaultError, "The URL's server encountered an internal error"],
]);

/**
 * Maps an HTTP error status from a URL the caller supplied, such as
 * tomtom-data-viz's data_url. The server behind it is not TomTom's, so unlike
 * a TomTom failure the messages name neither the TomTom API nor the API key.
 * @param status The HTTP status the URL answered with
 * @param cause The error the request failed with
 */
export function fromUrlStatus(status: number, cause: unknown): ErrorWithData {
  const failure = urlStatusFailure(status, cause);
  logger.error({ upstream: "data-url", errorKind: failure.name, status }, "Upstream call failed");
  return failure;
}

function urlStatusFailure(status: number, cause: unknown): ErrorWithData {
  const data = { status };
  const options = { cause, upstream: "data-url" } as const;
  const kind = kindForStatus(status);
  const message = URL_MESSAGE_BY_KIND.get(kind);
  if (message !== undefined) return new kind(message, data, options);
  // Redirects are not followed, so a 3xx is the caller's to resolve like a 404
  return new IncorrectError("The URL returned an HTTP error", data, options);
}

const URL_TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

export function fromUrlTransportFailure(code: string | undefined, cause: unknown): ErrorWithData {
  const failure = urlTransportFailure(code, cause);
  logger.error({ upstream: "data-url", errorKind: failure.name, code }, "Upstream call failed");
  return failure;
}

function urlTransportFailure(code: string | undefined, cause: unknown): ErrorWithData {
  const options = { cause, upstream: "data-url" } as const;
  if (code !== undefined && URL_TIMEOUT_CODES.has(code)) {
    return new InterruptedError("The URL's server took too long to answer", {}, options);
  }
  if (code === "ERR_BAD_RESPONSE") {
    return new IncorrectError(
      "The URL's file could not be read: it may be over the size limit",
      {},
      options
    );
  }
  return new UnavailableError("The URL's server could not be reached", {}, options);
}

export function inputIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  return issues.map(({ path, message }) => ({ path: path.join("."), message }));
}

/**
 * The JSON body a tool returns when it fails. For a caller error, the values
 * that were wrong ride along in details, since the message names none of them.
 * An upstream's error carries its message alone.
 */
export function toErrorPayload(error: Error): { error: string; details?: Record<string, unknown> } {
  if (
    error instanceof IncorrectError &&
    error.upstream === undefined &&
    Object.keys(error.data).length > 0
  ) {
    return { error: error.message, details: error.data };
  }
  return { error: error.message };
}
