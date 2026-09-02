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

export {
  type AgentRun,
  buildTools,
  EVAL_SYSTEM_PROMPT,
  runAgent,
  type ToolMode,
} from "./mcp-agent";
export { SPECIFIC_MOCKS } from "./mocks";
export {
  describeSetup,
  HAS_TOMTOM_KEY,
  JUDGE_MODEL,
  MODEL,
  MODELS,
  PROVIDER,
  type ProviderId,
  resolveModels,
  resolveProvider,
  type ScenarioModel,
} from "./model";
export {
  createToolScenarioRunner,
  expectAnyToolCalled,
  expectNoneOfToolsCalled,
  expectToolCallCount,
  expectToolCalledInOrder,
  FULL_SCENARIOS,
  formatScenarioFailure,
  type ScenarioOutcome,
  type ToolInputPredicate,
  type ToolScenarioOptions,
} from "./scenario";
export {
  readScenarioLog,
  recordScenario,
  SCENARIO_LOG_PATH,
  type ScenarioRecord,
  summarizeScenarios,
} from "./scenario-log";
export { liveSeed, priorTurn, type SeededToolCall, seedsAreLive, toolCall } from "./seed";
export { closeSharedSession, getSharedSession } from "./session";
export { openStdioSession, type StdioSession } from "./stdio-session";
export {
  LEGACY_EQUIVALENTS,
  LEGACY_TOOL_NAMES,
  type TranslatedExpectation,
  toLegacyExpectation,
} from "./surfaces";
export {
  artefactPath,
  assertTransportForTarget,
  type EvalTarget,
  REPO_ROOT,
  resolveTarget,
  TARGET,
} from "./target";
