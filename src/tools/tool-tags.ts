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
 * All valid tool tags for categorizing tools.
 *
 * The agent toolkit's `tool-tags.ts` vocabulary, so a tag means the same thing
 * on both sides, less the tags for services the MCP has no tool for, plus the
 * few the MCP surface needs and the toolkit does not.
 */
export const TOOL_TAGS = [
  "location",
  "route",
  "waypoint",
  "place",
  "locate",
  "discover",
  "traffic",
  "map style",
  "utilities",
  "search",
  "detour",
  "along-route",
  "EV",
  "coverage",
  // MCP-specific
  "geocode",
  "visualization",
  "app",
] as const;

/**
 * Union of all valid tool tags, derived from {@link TOOL_TAGS}.
 */
export type ToolTag = (typeof TOOL_TAGS)[number];
