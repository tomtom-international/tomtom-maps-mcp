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
 *
 * Raw TomTom REST client.
 *
 * Since the maps-sdk migration this axios instance has exactly ONE consumer —
 * the traffic incident-details endpoint, which the SDK does not yet cover — so
 * it lives here rather than in a `services/base` that every module imported for
 * its unrelated API-key helpers. When the SDK gains incident details, delete
 * this file and axios along with it.
 */

import axios, { type AxiosInstance } from "axios";
import { getAppConfig } from "../../appConfig";
import { logger } from "../../utils/logger";
import { TOMTOM_USER_AGENT_HEADER } from "../../utils/userAgent";
import { getEffectiveApiKey, serverUserAgent } from "../api-key";

/**
 * API version constants for the TomTom Maps API.
 * Only the traffic path still goes through raw REST; the rest are served by the
 * maps-sdk, which owns its own versioning.
 */
export const API_VERSION = {
  TRAFFIC: 1,
} as const;

/**
 * Core Axios client for raw TomTom REST requests.
 * Resolves the API key and server identity per request, so a `setHttpMode()`
 * after module load is always reflected.
 */
export const tomtomClient: AxiosInstance = axios.create({
  baseURL: getAppConfig().tomtomApiBaseUrl,
  paramsSerializer: { indexes: null },
});

// Request interceptor: inject the API key and the current server identity.
tomtomClient.interceptors.request.use(
  (config) => {
    const apiKey = getEffectiveApiKey();
    if (apiKey && !config.params?.key) {
      config.params = { ...config.params, key: apiKey };
    }

    // Read the identity per request rather than caching it in
    // `defaults.headers`: `setHttpMode()` can run after this module loads.
    config.headers.set(TOMTOM_USER_AGENT_HEADER, serverUserAgent());

    const { key: _key, ...safeParams } = (config.params ?? {}) as Record<string, unknown>;
    logger.debug(
      {
        method: config.method?.toUpperCase(),
        baseURL: config.baseURL,
        url: config.url,
        params: safeParams,
      },
      "→ TomTom API request"
    );

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to log outcome of TomTom API calls
tomtomClient.interceptors.response.use(
  (response) => {
    logger.info(
      {
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
      },
      "← TomTom API response"
    );
    return response;
  },
  (error) => {
    const config = error?.config;
    logger.info(
      {
        method: config?.method?.toUpperCase(),
        url: config?.url,
        status: error?.response?.status,
      },
      "← TomTom API error"
    );
    return Promise.reject(error);
  }
);
