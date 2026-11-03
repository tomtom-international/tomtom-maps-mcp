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
  type Upstream,
  type ErrorKind,
  type ErrorWithData,
  FaultError,
  ForbiddenError,
  IncorrectError,
  UnavailableError,
  UnknownError,
} from "../types/types";
import { logger } from "../utils/logger";

export interface UlsErrorBody {
  error?: string;
  error_description?: string;
}

// The /token errors ULS documents (cet-services docs/uls/ERRORS.md); invalid_grant on a
// subject token this server already verified means ULS will not exchange it, not a bad token.
const KIND_BY_ULS_ERROR = {
  access_denied: ForbiddenError,
  invalid_grant: ForbiddenError,
  unauthorized_client: FaultError,
  invalid_scope: IncorrectError,
  invalid_request: IncorrectError,
  unsupported_grant_type: IncorrectError,
  temporarily_unavailable: UnavailableError,
  server_error: FaultError,
} satisfies Record<string, ErrorKind>;

type UlsError = keyof typeof KIND_BY_ULS_ERROR;

const isUlsError = (error: string | undefined): error is UlsError =>
  error !== undefined && Object.hasOwn(KIND_BY_ULS_ERROR, error);

export function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return ForbiddenError;
  if (status === 429) return BusyError;
  if (status === 503) return UnavailableError;
  if (status >= 500) return FaultError;
  return UnknownError;
}

export function fromUlsResponse(
  upstream: Extract<Upstream, "uls-api-key" | "uls-token-exchange">,
  status: number,
  body: UlsErrorBody | null,
  context: Record<string, unknown> = {}
): ErrorWithData {
  const error = body?.error;
  const kind = isUlsError(error) ? KIND_BY_ULS_ERROR[error] : kindForStatus(status);
  const failure = new kind("ULS refused the token exchange", { status, error }, { upstream });
  logger.error(
    {
      ...context,
      upstream,
      errorKind: failure.name,
      status,
      error,
      errorDescription: body?.error_description,
    },
    "ULS token exchange failed"
  );
  return failure;
}
