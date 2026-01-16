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
import { TomTomApiError, TomTomErrorResponse, UnavailableError, ErrorInfo, UnknownError } from "../types/types";

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

      // Provide specific guidance based on status code
      let userMessage = `API error: ${statusCode} - ${errorMessage}`;

      if (statusCode === 401 || statusCode === 403) {
        userMessage = `Authentication error: Your TomTom API key may be invalid, expired, or missing permissions for this request. Status: ${statusCode}`;
      } else if (statusCode === 429) {
        userMessage = `Rate limit exceeded: You've made too many requests to the TomTom API. Please try again later. Status: ${statusCode}`;
      } else if (statusCode === 503) {
        // Enhanced 503 error message with more specific guidance
        if (errorMessage.includes("no healthy upstream")) {
          userMessage = `TomTom service temporarily unavailable: This specific service (${context}) is experiencing an outage. This is a TomTom server issue, not an issue with your API key or implementation. Please try again in a few minutes, or check the TomTom status page for service updates. Other TomTom services like search might still be available. Status: ${statusCode}`;
        } else {
          userMessage = `TomTom service unavailable: The service might be temporarily down or undergoing maintenance. Please try again later. Status: ${statusCode}`;
        }
      } else if (statusCode >= 500 && statusCode < 600) {
        // General server error handling
        userMessage = `TomTom server error: The service encountered an internal error. This is likely a temporary issue on TomTom's side. Please try again in a few minutes. Status: ${statusCode}`;
      }

      logger.error({ context, status_code: statusCode, error: errorMessage }, "Request failed with status code");
      return new TomTomApiError(statusCode, userMessage, axiosError.response);
    } else if (axiosError.request) {
      // Request was made but no response received
      const userMessage =
        "No response received from TomTom API server. Please check your internet connection.";
      logger.error({ context, error: userMessage }, "Request failed");
      return new UnavailableError(userMessage);
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
