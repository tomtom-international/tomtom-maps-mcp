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

import type { SDKErrorCode } from "@tomtom-org/maps-sdk/core";
import { SDKError, SDKServiceError } from "@tomtom-org/maps-sdk/services";
import { UPSTREAM_REQUEST_TIMEOUT_MS } from "../../constants";
import {
  BusyError,
  type Upstream,
  type ErrorWithData,
  FaultError,
  ForbiddenError,
  IncorrectError,
  InterruptedError,
  NotFoundError,
  UnavailableError,
  UnknownError,
} from "../../types/types";
import { inputIssues, REQUEST_FAILED_MESSAGE } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";

type Kind = new (...args: ConstructorParameters<typeof ErrorWithData>) => ErrorWithData;

const KIND_BY_CODE: Record<SDKErrorCode, { kind: Kind; message: string }> = {
  RATE_LIMITED: {
    kind: BusyError,
    message: "The TomTom service is busy: wait a moment and retry.",
  },
  LIVE_SERVICE_NOT_AVAILABLE: {
    kind: UnavailableError,
    message: "The TomTom service is unavailable right now: retry later.",
  },
  NETWORK_NOT_AVAILABLE: {
    kind: UnavailableError,
    message: "The TomTom service is unavailable right now: retry later.",
  },
  ABORTED: {
    kind: InterruptedError,
    message: "The TomTom service took too long to answer: retry.",
  },
  INVALID_CREDENTIALS: {
    kind: ForbiddenError,
    message:
      "TomTom rejected the API key as missing or invalid: check the server's TOMTOM_API_KEY or the request's tomtom-api-key header, or reconnect to sign in again",
  },
  INSUFFICIENT_PERMISSIONS: {
    kind: ForbiddenError,
    message:
      "TomTom refused this request for the API key: its account has used up its free requests for this API, its plan does not include this API, or this API is not among the key's products. " +
      "Retrying will not help, so tell the user. Plans and free allowances: https://docs.tomtom.com/pricing",
  },
  NOT_FOUND: {
    kind: NotFoundError,
    message: "The TomTom service found nothing for this request: change the inputs.",
  },
  INVALID_REQUEST: {
    kind: IncorrectError,
    message: "The TomTom service rejected the request: check the inputs.",
  },
  INTERNAL: {
    kind: FaultError,
    message: "The TomTom service failed: retry later.",
  },
  INSECURE_BASE_URL: {
    kind: UnknownError,
    message: REQUEST_FAILED_MESSAGE,
  },
  WEBGL_UNSUPPORTED: {
    kind: UnknownError,
    message: REQUEST_FAILED_MESSAGE,
  },
  WEBGL_CONTEXT_LOST: {
    kind: UnknownError,
    message: REQUEST_FAILED_MESSAGE,
  },
  STYLE_LOAD_FAILED: {
    kind: UnknownError,
    message: REQUEST_FAILED_MESSAGE,
  },
};

export async function serviceCall<T>(
  upstream: Upstream,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const started = performance.now();
  try {
    return await run(AbortSignal.timeout(UPSTREAM_REQUEST_TIMEOUT_MS));
  } catch (error) {
    if (!(error instanceof SDKError)) throw error;
    if (error.code === "INVALID_REQUEST" && !(error instanceof SDKServiceError)) {
      throw new IncorrectError(
        "The inputs are invalid: fix them and call again.",
        error.issues ? { issues: inputIssues(error.issues) } : {},
        { cause: error }
      );
    }
    const status = error instanceof SDKServiceError ? error.status : undefined;
    const { kind, message } = KIND_BY_CODE[error.code];
    const failure = new kind(message, { code: error.code, status }, { cause: error, upstream });
    logger.error(
      {
        upstream,
        errorKind: failure.name,
        code: error.code,
        status,
        elapsedMs: Math.round(performance.now() - started),
      },
      "Upstream call failed"
    );
    throw failure;
  }
}
