/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import { randomUUID } from "node:crypto";
import { CLIENT_APPS, type ClientApps } from "./clientApps";
import { CLIENT_FAMILIES, type ClientFamily } from "./clientFamily";

export interface ClientSession {
  apps: ClientApps;
  family: ClientFamily;
}

const TOKEN_DELIMITER = ".";
const LEGACY_TEXT_ONLY_PREFIX = "text-only-";

// The HTTP server keeps no state: the Mcp-Session-Id a client MUST echo carries what its initialize decided. Otherwise, client-attribution is not possible after the first OAuth exchange
export function mintSessionId(session: ClientSession): string {
  return [session.apps, session.family, randomUUID()].join(TOKEN_DELIMITER);
}

export function parseSessionId(sessionId: string | undefined): ClientSession {
  if (sessionId?.startsWith(LEGACY_TEXT_ONLY_PREFIX))
    return { apps: "text-only", family: "unknown" };
  const [apps, family] = sessionId?.split(TOKEN_DELIMITER) ?? [];
  return {
    apps: oneOf(CLIENT_APPS, apps) ?? "unknown",
    family: oneOf(CLIENT_FAMILIES, family) ?? "unknown",
  };
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((candidate) => candidate === value);
}
