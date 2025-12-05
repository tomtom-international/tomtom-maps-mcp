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
 * Custom error class for network issues
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";

    // Ensures proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
