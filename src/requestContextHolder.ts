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

interface RequestContext {
  trackingId: string;
  session?: string;
  user_agent?: string;
  client?: string;
}

// Gateway keeps a caller's Tracking-Id only when it is a UUID, and replaces anything else
const GATEWAY_TRACKING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Like a Java ThreadLocal, but carried along the request's async calls: every line logged
// in that chain gets the same tracking id, session and client, so none is passed by hand
const store = new AsyncLocalStorage<RequestContext>();

// Over stdio one client owns the process, named once it initializes
let stdioClient: string | undefined;

export const RequestContextHolder = {
  run<T>(context: RequestContext, fn: () => T): T {
    return store.run(context, fn);
  },

  current(): Partial<RequestContext> | undefined {
    return store.getStore() ?? (stdioClient === undefined ? undefined : { client: stdioClient });
  },

  nameClient(client: string): void {
    const context = store.getStore();
    if (context) context.client = client;
    else stdioClient = client;
  },
};

export function adoptTrackingId(header: string | undefined): string {
  return header !== undefined && GATEWAY_TRACKING_ID.test(header) ? header : randomUUID();
}
