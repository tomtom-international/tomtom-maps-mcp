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

import { logger } from "./logger";
import axios, { AxiosError } from "axios";
import { TomTomErrorResponse, UnavailableError, ErrorInfo, UnknownError, ForbiddenError, BusyError, FaultError, IncorrectError } from "../types/types";

/**
 * Handles errors from API calls, providing standardized error handling across services
 * @param error The error object from the API call
 * @param context Optional context description for logging
 * @returns A standardized error object
 */
export function handleApiError(error: unknown, context: string = "API call"): Error {
  // Pass through ErrorInfo subclasses unchanged
  if (error instanceof ErrorInfo) {
    return error;
  }

  // Handle axios errors
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<TomTomErrorResponse>;

    if (axiosError.response) {
      // Server responded with an error status
      const statusCode = axiosError.response.status;
      let errorMessage = "";

      // Process TomTom specific error responses
      if (typeof axiosError.response.data === "object" && axiosError.response.data) {
        const responseData = axiosError.response.data;

        // Try to extract detailed error message from TomTom error format
        if (responseData.detailedError) {
          errorMessage = `${responseData.detailedError.code || ""}: ${responseData.detailedError.message || ""}`;
        } else if (responseData.error) {
          errorMessage = responseData.error;
        } else {
          errorMessage = JSON.stringify(responseData);
        }
      } else {
        errorMessage = String(axiosError.response.data);
      }

      // Map status codes to appropriate error categories
      const baseData = {
        domain: "tomtom_api",
        status_code: statusCode,
        context,
        error_details: errorMessage
      };

      logger.error({ context, status_code: statusCode, error: errorMessage }, "Request failed with status code");

      // 401/403: Authentication/Authorization errors
      if (statusCode === 401 || statusCode === 403) {
        return new ForbiddenError(
          "Your TomTom API key may be invalid, expired, or missing permissions for this request",
          baseData
        );
      }

      // 429: Rate limiting
      if (statusCode === 429) {
        return new BusyError(
          "Rate limit exceeded: Too many requests to the TomTom API",
          baseData
        );
      }

      // 400: Bad request (incorrect input)
      if (statusCode === 400) {
        return new IncorrectError(
          "Bad request to TomTom API",
          baseData
        );
      }

      // 503: Service unavailable
      if (statusCode === 503) {
        if (errorMessage.includes("no healthy upstream")) {
          return new UnavailableError(
            `TomTom service temporarily unavailable: This specific service (${context}) is experiencing an outage`,
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

      // Other errors: Unknown
      return new UnknownError(
        `API error: ${statusCode}`,
        baseData
      );
    } else if (axiosError.request) {
      // Request was made but no response received
      const userMessage =
        "No response received from TomTom API server. Please check your internet connection.";
      logger.error({ context, error: userMessage }, "Request failed");
      return new UnavailableError(userMessage, {
        domain: "tomtom_api",
        context
      });
    }
  }

  // Handle other types of errors
  if (error instanceof Error) {
    logger.error({ context, error: error.message }, "Request failed with unknown error");
    return new UnknownError("Unknown error", { context }, { cause: error });
  }

  const errorMessage = String(error);
  logger.error({ context, error: errorMessage }, "Request failed with unknown error");
  return new UnknownError("Unknown error", {
    context,
    error_value: errorMessage
  });
}
