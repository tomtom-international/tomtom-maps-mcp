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

// As seen in prod logs
export const AI_CLIENTS = [
  { name: "Anthropic/ClaudeAI", userAgentToken: "Anthropic%2FClaudeAI" },
  { name: "claude-code", userAgentToken: "claude-code" },
  { name: "openai-mcp (Codex)", userAgentToken: "openai-mcp%20(Codex)" },
  { name: "codex-mcp-client", userAgentToken: "codex-mcp-client" },
];

export const CLIENTS_WITHOUT_VALID_NAME = [
  { name: "", userAgentToken: "unknown" },
  { name: "   ", userAgentToken: "unknown" },
  { name: "claude\u0007code", userAgentToken: "unknown" },
];
