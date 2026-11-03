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

import { type ErrorKindName, type ErrorWithData, isErrorKindName } from "./types/types";

interface HttpErrorResponse {
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

const REQUEST_FAILED: HttpErrorResponse = {
  status: 500,
  message: "The request failed: retry, or tell the user.",
};

const RESPONSE_BY_KIND: Record<ErrorKindName, HttpErrorResponse> = {
  ForbiddenError: {
    status: 403,
    message: "Your account may not get an API key for this server: ask its owner for access.",
  },
  UnavailableError: {
    status: 503,
    message: "Sign-in is unavailable right now: retry later.",
    retryAfterSeconds: 30,
  },
  InterruptedError: { status: 504, message: "Sign-in took too long: retry." },
  BusyError: { status: 429, message: "Sign-in is busy: wait a moment and retry." },
  FaultError: { status: 502, message: "Sign-in failed: retry later." },
  IncorrectError: { status: 400, message: "The request could not be signed in: reconnect." },
  NotFoundError: REQUEST_FAILED,
  ConflictError: REQUEST_FAILED,
  UnsupportedError: REQUEST_FAILED,
  UnknownError: REQUEST_FAILED,
};

export function httpErrorResponse(error: ErrorWithData): HttpErrorResponse {
  return isErrorKindName(error.name) ? RESPONSE_BY_KIND[error.name] : REQUEST_FAILED;
}
