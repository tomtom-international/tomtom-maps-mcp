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

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface LogContext {
  requestId: string;
  session?: string;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

// Like a Java ThreadLocal, but carried along the request's async calls: every line logged
// in that chain gets the same request id and session, so neither is passed by hand
const store = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return store.run(context, fn);
}

export function logContext(): LogContext | undefined {
  return store.getStore();
}

export function adoptRequestId(header: string | undefined): string {
  return header !== undefined && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}
