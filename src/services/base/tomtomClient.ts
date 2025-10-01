/*
 * Copyright (C) 2025 TomTom NV
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

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { logger } from "../../utils/logger";
import { VERSION } from "../../version";

// Load environment variables
dotenv.config();

/**
 * TomTom API configuration constants
 */
export const CONFIG = {
  BASE_URL: "https://api.tomtom.com",
} as const;

/**
 * Gets the TomTom API key from environment variables
 * This ensures we always get the most up-to-date value
 * @returns The API key from environment variables or undefined if not set
 */
function getApiKeyFromEnv(): string | undefined {
  const apiKey = process.env.TOMTOM_API_KEY;

  if (!apiKey) {
    const errorMessage = "ERROR: TOMTOM_API_KEY environment variable is not set!";
    logger.error(errorMessage);
    logger.error("Please set your TomTom API key in the .env file or as an environment variable.");
    logger.error("You can get a key from https://developer.tomtom.com/");
    // Don't throw here - we'll check for API key before each request
  }

  return apiKey;
}

/**
 * Core Axios client for TomTom API requests
 * Always reads the current API key from environment variables
 */
export const tomtomClient: AxiosInstance = axios.create({
  baseURL: CONFIG.BASE_URL,
  params: { key: getApiKeyFromEnv() },
  paramsSerializer: { indexes: null },
  headers: {
    "TomTom-User-Agent": `TomTomMCPSDK/${VERSION}`,
  },
});

/**
 * Helper function to validate that API key exists before making calls
 * @throws {Error} If the API key is not set
 * @returns {void} Nothing if validation passes
 */
export function validateApiKey(): void {
  const apiKey = getApiKeyFromEnv();
  if (!apiKey) {
    throw new Error("TomTom API key is not set. Please set TOMTOM_API_KEY environment variable.");
  }
}

/**
 * Export the getApiKeyFromEnv function for access in other modules
 */
export { getApiKeyFromEnv };

/**
 * API version constants for Genesis API
 * Each API has its own version number which can change independently
 */
export const API_VERSION = {
  SEARCH: 2,
  GEOCODING: 2,
  ROUTING: 1,
  TRAFFIC: 5,
  MAP: 1,
} as const;

/**
 * API version constants for Orbis API
 * Each API has its own version number which can be different from Genesis API
 */
export const ORBIS_API_VERSION = {
  SEARCH: 1,
  GEOCODING: 1,
  ROUTING: 2,
  TRAFFIC: 1,
  MAP: 1,
} as const;
