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

import { errorResult, type MCPResponse } from "../handlers/shared/responseTrimmer";
import { IncorrectError } from "../types/types";
import { isRecord } from "../utils/record";

/**
 * An argument that shows the call is on the previous contract.
 * `present`: the current schema does not accept this path.
 * `string`: the input stayed, and a string is the previous contract (it is a list now).
 */
export interface ContractTrigger {
  path: string;
  when: "present" | "string";
}

/** A breaking change to a tool that kept its name (ADR 0011). */
export interface ContractChange {
  /** The last release that had the previous contract. */
  lastRelease: string;
  triggers: readonly ContractTrigger[];
  /** What the caller reads: how the old inputs map, and what the result no longer contains. */
  message: string;
}

const removed = (...paths: string[]): ContractTrigger[] =>
  paths.map((path) => ({ path, when: "present" }));

const paging =
  "Page with cursor, the nextCursor of the previous response, and the same other inputs.";

/**
 * A tool that kept its name. A call that matches a trigger gets `message` and does not run.
 * Retiring the tool deletes its entry.
 */
export const CONTRACT_CHANGES: ReadonlyMap<string, ContractChange> = new Map([
  [
    "tomtom-fuzzy-search",
    {
      lastRelease: "1.6.11",
      triggers: removed("ofs", "ext", "vehicleTypeSet"),
      message:
        "tomtom-fuzzy-search no longer takes ofs, ext or vehicleTypeSet. " +
        `${paging} ext and vehicleTypeSet have no counterpart.`,
    },
  ],
  [
    "tomtom-poi-search",
    {
      lastRelease: "1.6.11",
      triggers: removed("ofs", "ext", "vehicleTypeSet", "chargingAvailability"),
      message:
        "tomtom-poi-search no longer takes ofs, ext, vehicleTypeSet or chargingAvailability. " +
        `${paging} ext and vehicleTypeSet have no counterpart. chargingAvailability has no counterpart: ` +
        "a station still lists its connectors and power, without their real-time status.",
    },
  ],
  [
    "tomtom-nearby",
    {
      lastRelease: "1.6.11",
      triggers: removed("ofs", "ext", "vehicleTypeSet", "parkingAvailability"),
      message:
        "tomtom-nearby no longer takes ofs, ext, vehicleTypeSet or parkingAvailability. " +
        `${paging} ext, vehicleTypeSet and parkingAvailability have no counterpart.`,
    },
  ],
  [
    "tomtom-geocode",
    {
      lastRelease: "1.6.11",
      triggers: removed("ofs", "timeZone"),
      message: `tomtom-geocode no longer takes ofs or timeZone. ${paging} timeZone has no counterpart.`,
    },
  ],
  [
    "tomtom-reverse-geocode",
    {
      lastRelease: "1.6.11",
      triggers: removed(
        "limit",
        "countries",
        "extendedPostalCodesFor",
        "mapcodes",
        "timeZone",
        "returnMatchType",
        "returnSpeedLimit",
        "allowFreeformNewLine",
        "returnRoadClass",
        "callback",
        "filter"
      ),
      message:
        "tomtom-reverse-geocode no longer takes limit, countries, extendedPostalCodesFor, mapcodes, timeZone, " +
        "returnMatchType, returnSpeedLimit, allowFreeformNewLine, returnRoadClass, callback or filter, and none of " +
        "them has a counterpart. Addresses no longer carry buildingNumber, street, streetNameAndNumber, routeNumbers " +
        "or localName, and neighbourhood is neighborhood.",
    },
  ],
  [
    "tomtom-ev-search",
    {
      lastRelease: "1.6.11",
      triggers: removed("includeAvailability"),
      message:
        "tomtom-ev-search no longer takes includeAvailability. A station still lists its connectors and power, " +
        "without their real-time status.",
    },
  ],
  [
    "tomtom-routing",
    {
      lastRelease: "1.6.11",
      triggers: removed(
        "alternativeType",
        "supportingPoints",
        "minDeviationDistance",
        "minDeviationTime",
        "supportingPointIndexOfOrigin",
        "reconstructionMode",
        "routeRepresentation",
        "extendedRouteRepresentation",
        "vehicleEngineType",
        "currentChargeInkWh",
        "maxChargeInkWh",
        "constantSpeedConsumptionInkWhPerHundredkm",
        "auxiliaryPowerInkW",
        "constantSpeedConsumptionInLitersPerHundredkm",
        "currentFuelInLiters",
        "auxiliaryPowerInLitersPerHour",
        "fuelEnergyDensityInMJoulesPerLiter",
        "vehicleHasElectricTollCollectionTransponder",
        "arrivalSidePreference",
        "accelerationEfficiency",
        "decelerationEfficiency",
        "uphillEfficiency",
        "downhillEfficiency",
        "consumptionInkWhPerkmAltitudeGain",
        "recuperationInkWhPerkmAltitudeLoss"
      ),
      message:
        "tomtom-routing no longer takes the route-reconstruction inputs (alternativeType, supportingPoints, " +
        "minDeviationDistance, minDeviationTime, supportingPointIndexOfOrigin, reconstructionMode, " +
        "routeRepresentation, extendedRouteRepresentation) or the charging and fuel inputs (vehicleEngineType, " +
        "currentChargeInkWh, maxChargeInkWh, constantSpeedConsumptionInkWhPerHundredkm, auxiliaryPowerInkW, " +
        "constantSpeedConsumptionInLitersPerHundredkm, currentFuelInLiters, auxiliaryPowerInLitersPerHour, " +
        "fuelEnergyDensityInMJoulesPerLiter, accelerationEfficiency, decelerationEfficiency, uphillEfficiency, " +
        "downhillEfficiency, consumptionInkWhPerkmAltitudeGain, recuperationInkWhPerkmAltitudeLoss, " +
        "vehicleHasElectricTollCollectionTransponder, arrivalSidePreference), and none of them has a counterpart. " +
        "The summary no longer carries battery or fuel consumption. Plan with locations, routeType, travelMode, " +
        "traffic, avoid, departAt, arriveAt, maxAlternatives, vehicleMaxSpeed, vehicleWeight, vehicleHeading and sectionType.",
    },
  ],
  [
    "tomtom-traffic",
    {
      lastRelease: "1.6.11",
      triggers: [
        ...removed("fields"),
        { path: "categoryFilter", when: "string" },
        { path: "timeValidityFilter", when: "string" },
      ],
      message:
        "tomtom-traffic's categoryFilter takes a list of names, such as accident or road-closed, instead of a " +
        "comma-separated string of codes, and timeValidityFilter takes a list, present or future, instead of a " +
        "comma-separated string. fields was removed: the response fields are fixed. Compact incidents use category " +
        "and magnitudeOfDelay names, lengthInMeters and delayInSeconds, instead of iconCategory codes and length and delay.",
    },
  ],
  [
    "tomtom-dynamic-map",
    {
      lastRelease: "1.6.11",
      triggers: removed("routeInfoDetail", "center.label"),
      message:
        "tomtom-dynamic-map no longer takes routeInfoDetail or center.label. routeInfoDetail has no counterpart. " +
        "center is lat and lon only.",
    },
  ],
]);

export interface ContractMatch {
  lastRelease: string;
  inputs: readonly string[];
  result: MCPResponse;
}

/** The error for a call on a tool's previous contract, or nothing when the call is on the current one. */
export function contractChangeFor(name: string, args: unknown): ContractMatch | undefined {
  const change = CONTRACT_CHANGES.get(name);
  if (!change) return undefined;
  const inputs = change.triggers
    .filter((trigger) => triggerMatches(args, trigger))
    .map((trigger) => trigger.path);
  if (inputs.length === 0) return undefined;
  return {
    lastRelease: change.lastRelease,
    inputs,
    result: errorResult(
      new IncorrectError(change.message, { tool: name, lastRelease: change.lastRelease, inputs })
    ),
  };
}

function triggerMatches(args: unknown, trigger: ContractTrigger): boolean {
  const { found, value } = valueAt(args, trigger.path);
  if (!found) return false;
  return trigger.when === "present" || typeof value === "string";
}

function valueAt(root: unknown, path: string): { found: boolean; value: unknown } {
  let current = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}
