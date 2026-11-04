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
 * The dataset store — server-held tool results, addressable by `dataset_id`.
 *
 * Every data tool keeps its full untrimmed result here and names it in its
 * response, so the model can pass the handle back: to `tomtom-describe-dataset`
 * and `tomtom-analyse-datasets`, as a location, as a `where` scope, or to
 * `tomtom-data-viz`. The app data still travels inline in the result
 * (ADR 0009); the store is for the model.
 *
 * - **Owner scoping.** A `dataset_id` the model can pass to a read tool is a
 *   guessable read primitive. Entries are keyed by the resolved principal and a
 *   cross-owner read is reported as "not found" — the same answer as a genuine
 *   miss, so the store never confirms that someone else's id exists.
 * - **A byte budget**, per owner and per process, oldest first.
 *
 * Explicitly a per-process cache: a follow-up call that lands on another pod
 * misses, and the miss names the call that produced the dataset.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Feature } from "geojson";
import { DATASET_TTL_SECONDS, datasetLifetimePhrase } from "../../schemas/datasets/datasetLifetime";
import { datasetNoteFor } from "../../schemas/shared/response-shapes";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { redactCredentials } from "../../utils/redact";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { type DatasetSummary, summarize } from "./summarize";

/** Total estimated bytes held across all owners before eviction kicks in. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** Hard entry ceiling, as a second guard for many small datasets. */
const MAX_ENTRIES = 500;
/** Per-owner ceilings, so one caller cannot evict everyone else. */
const MAX_OWNER_BYTES = 64 * 1024 * 1024;
const MAX_OWNER_ENTRIES = 100;

/**
 * Provenance outlives the data it describes, at 4x the TTL, so an expired id can
 * name the call to re-issue. It is never replayed automatically: re-running a
 * traffic query later returns different incidents, and an analysis over them
 * would describe a different world than the id implied.
 */
const PROVENANCE_TTL_SECONDS = DATASET_TTL_SECONDS * 4;

/** The tools whose results the store holds. */
export type DatasetTool =
  | "tomtom-discover-places"
  | "tomtom-locate-place"
  | "tomtom-plan-route"
  | "tomtom-get-traffic"
  | "tomtom-data-viz"
  | "tomtom-derive-datasets";

/** What produced a dataset — enough to re-run it. */
export interface DatasetProvenance {
  tool: DatasetTool;
  params: unknown;
  /** The datasets a derived dataset was computed from. */
  derivedFrom?: string[];
  /** What a derived dataset holds, in the words of the call that made it. */
  description?: string;
}

export interface Dataset {
  id: string;
  /** The UNTRIMMED tool result. */
  data: unknown;
  /** The result's features: every result these tools hold is a FeatureCollection. */
  features: Feature[];
  summary: DatasetSummary;
  provenance: DatasetProvenance;
  /** Opaque principal digest — never the key itself. */
  owner: string;
  createdAt: number;
  /** Its serialized length, geometry included: a lower bound on the memory it holds. */
  bytes: number;
}

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

interface ProvenanceEntry {
  owner: string;
  provenance: DatasetProvenance;
}

/** Insertion-ordered, so iteration is oldest first. */
const store = new Map<string, Expiring<Dataset>>();
const provenanceIndex = new Map<string, Expiring<ProvenanceEntry>>();

const live = <T>(map: Map<string, Expiring<T>>, key: string): T | undefined => {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt > Date.now()) return entry.value;
  map.delete(key);
  return undefined;
};

const sweep = <T>(map: Map<string, Expiring<T>>): void => {
  const now = Date.now();
  for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
};

/**
 * Digest of the resolved principal: hashed so the store never holds an API key.
 * No key (stdio without configuration) is a single `anonymous` owner, which the
 * hosted server never reaches, as it requires a key per request.
 */
function currentOwner(): string {
  const key = getEffectiveApiKey();
  if (!key) return "anonymous";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function evict(entry: Dataset, reason: string): void {
  store.delete(entry.id);
  logger.debug({ dataset_id: entry.id, freedBytes: entry.bytes, reason }, "Evicted dataset");
}

/** Brings one owner back inside their own share, oldest of theirs first. */
function enforceOwnerBudget(owner: string): void {
  const mine = [...store.values()].map(({ value }) => value).filter((d) => d.owner === owner);
  let bytes = mine.reduce((sum, entry) => sum + entry.bytes, 0);
  let count = mine.length;
  for (const entry of mine) {
    if (bytes <= MAX_OWNER_BYTES && count <= MAX_OWNER_ENTRIES) break;
    evict(entry, "owner budget");
    bytes -= entry.bytes;
    count -= 1;
  }
}

/** Brings the whole store inside the process budget, from the heaviest owner first. */
function enforceGlobalBudget(): void {
  let entries = [...store.values()].map(({ value }) => value);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  while (totalBytes > MAX_TOTAL_BYTES || entries.length > MAX_ENTRIES) {
    const byOwner = new Map<string, { bytes: number; oldest: Dataset }>();
    for (const entry of entries) {
      const seen = byOwner.get(entry.owner);
      if (seen) seen.bytes += entry.bytes;
      else byOwner.set(entry.owner, { bytes: entry.bytes, oldest: entry });
    }
    const [heaviest] = [...byOwner.values()].sort((a, b) => b.bytes - a.bytes);
    if (!heaviest) break;
    evict(heaviest.oldest, "process budget");
    totalBytes -= heaviest.oldest.bytes;
    entries = entries.filter((entry) => entry.id !== heaviest.oldest.id);
  }
}

const featuresOf = (data: unknown): Feature[] => {
  const features = (data as { features?: unknown } | null)?.features;
  return Array.isArray(features) ? (features as Feature[]) : [];
};

type HeldConnector = { connector?: Record<string, unknown>; [field: string]: unknown };

/**
 * A place as code reads it: each connector also carries the flat fields the trimmed
 * result shows (`{ type, ratedPowerKW, count }`) beside the API's nested `connector`.
 * Code is written against the result the model saw: measured, code reading
 * `connectors[].ratedPowerKW` summed every station to 0 kW over the raw shape.
 */
const withFlatConnectors = (feature: Feature): Feature => {
  const park = (feature.properties as { chargingPark?: { connectors?: HeldConnector[] } } | null)
    ?.chargingPark;
  if (!park?.connectors?.length) return feature;
  return {
    ...feature,
    properties: {
      ...feature.properties,
      chargingPark: {
        ...park,
        connectors: park.connectors.map((entry) => ({ ...entry.connector, ...entry })),
      },
    },
  };
};

/**
 * Stores an untrimmed tool result for the current principal.
 *
 * The SDK echoes request params, the API key included, into feature properties,
 * and stored data is readable by model-authored code, so it is redacted on the
 * way in.
 */
export function storeDataset(data: unknown, provenance: DatasetProvenance): Dataset {
  redactCredentials(data);
  const features = featuresOf(data).map(withFlatConnectors);
  const summary = summarize({ features });
  // The envelope with the features as code reads them; the caller's object is left as it is.
  const held = data && typeof data === "object" ? { ...data, features } : data;
  const dataset: Dataset = {
    id: `ds_${randomBytes(8).toString("hex")}`,
    data: held,
    features,
    summary,
    provenance,
    owner: currentOwner(),
    createdAt: Date.now(),
    bytes: JSON.stringify(held ?? null).length,
  };

  sweep(store);
  sweep(provenanceIndex);
  store.set(dataset.id, { value: dataset, expiresAt: Date.now() + DATASET_TTL_SECONDS * 1000 });
  provenanceIndex.set(dataset.id, {
    value: { owner: dataset.owner, provenance },
    expiresAt: Date.now() + PROVENANCE_TTL_SECONDS * 1000,
  });
  enforceOwnerBudget(dataset.owner);
  enforceGlobalBudget();

  logger.debug({ dataset_id: dataset.id, count: summary.count, bytes: dataset.bytes }, "Stored");
  return dataset;
}

/**
 * Restarts a dataset's lifetime and puts it last in line for eviction, so the
 * sources of a chain of derived datasets live as long as the chain is in use.
 */
function touch(dataset: Dataset): void {
  const now = Date.now();
  store.delete(dataset.id);
  store.set(dataset.id, { value: dataset, expiresAt: now + DATASET_TTL_SECONDS * 1000 });
  const recalled = provenanceIndex.get(dataset.id);
  if (recalled) recalled.expiresAt = now + PROVENANCE_TTL_SECONDS * 1000;
}

/**
 * Reads a dataset the CURRENT principal owns, which restarts its lifetime.
 * Someone else's returns `undefined`, identical to a miss, so the store cannot be
 * used to probe which ids exist.
 */
export function getDataset(datasetId: string): Dataset | undefined {
  const dataset = live(store, datasetId);
  if (!dataset) return undefined;
  if (dataset.owner !== currentOwner()) {
    // On the hosted server this is either a bug or a probe.
    logger.warn({ dataset_id: datasetId }, "Dataset access denied: different owner");
    return undefined;
  }
  touch(dataset);
  return dataset;
}

/**
 * The error for an unavailable dataset. Names the originating call when the
 * provenance index still remembers it, so the model can re-issue exactly that.
 */
export function missingDatasetError(datasetId: string): IncorrectError {
  const recalled = live(provenanceIndex, datasetId);
  const lifetime = datasetLifetimePhrase();
  if (!recalled || recalled.owner !== currentOwner()) {
    return new IncorrectError(
      "The dataset is not available: it may have expired, or the id may be wrong. Re-run the " +
        "tool that produced it to get a fresh dataset_id.",
      { dataset_id: datasetId, lifetime }
    );
  }
  return new IncorrectError(
    "The dataset has expired. Re-run the call in `producedBy` to get a fresh dataset_id; the " +
      "result may differ if the underlying data has changed since.",
    {
      dataset_id: datasetId,
      lifetime,
      producedBy: {
        tool: recalled.provenance.tool,
        params: JSON.stringify(recalled.provenance.params).slice(0, 400),
      },
    }
  );
}

/**
 * The caller's dataset by id.
 *
 * @throws IncorrectError from {@link missingDatasetError} when it is unavailable.
 */
export function requireDataset(datasetId: string): Dataset {
  const dataset = getDataset(datasetId);
  if (!dataset) throw missingDatasetError(datasetId);
  return dataset;
}

/** Store totals, for tests and monitoring. */
export function getDatasetStoreStats(): { entries: number; bytes: number } {
  sweep(store);
  const entries = [...store.values()];
  return {
    entries: entries.length,
    bytes: entries.reduce((sum, { value }) => sum + value.bytes, 0),
  };
}

/** Clears every dataset and its provenance. For tests. */
export function clearDatasetStore(): void {
  store.clear();
  provenanceIndex.clear();
}

/** What a data tool's result says about its dataset, for the model to pass back. */
export const datasetReference = (
  dataset: Pick<Dataset, "id" | "provenance">
): { dataset_id: string; dataset_expires_in_seconds: number; dataset_note?: string } => {
  const note = datasetNoteFor(dataset.provenance.tool);
  return {
    dataset_id: dataset.id,
    dataset_expires_in_seconds: DATASET_TTL_SECONDS,
    ...(note && { dataset_note: note }),
  };
};
