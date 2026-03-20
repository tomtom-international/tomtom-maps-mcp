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

import { z } from "zod";

/**
 * Response detail level schema.
 * Allows agents to choose between compact (trimmed) and full responses.
 *
 * - compact: Returns trimmed response with essential fields only (default)
 *   - Significantly reduces token usage
 *   - Removes large arrays like coordinates, detailed classifications, etc.
 *   - UI Apps automatically fetch full data via visualization tools
 *
 * - full: Returns complete API response with all fields
 *   - Use when you need detailed data like opening hours, classifications, coordinates
 *   - Higher token usage but complete information
 */
export const responseDetailSchema = z
  .enum(["compact", "full"])
  .optional()
  .default("compact")
  .describe(
    "Response detail level. 'compact' (default): trimmed response with essential fields only, saves tokens. 'full': complete API response with all fields including coordinates, classifications, etc."
  );

/**
 * Type for response detail level
 */
export type ResponseDetail = z.infer<typeof responseDetailSchema>;
