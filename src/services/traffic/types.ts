/*
 * Copyright (C) 2025 TomTom NV
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
 * Traffic incident categories for filtering
 */
export const TRAFFIC_INCIDENT_CATEGORIES = {
  ACCIDENT: "0",
  FOG: "1",
  DANGEROUS_CONDITIONS: "2",
  RAIN: "3",
  ICE: "4",
  JAM_LANE_RESTRICTIONS: "5",
  LANE_CLOSURE: "6",
  ROAD_CLOSURE: "7",
  ROAD_WORKS: "8",
  WIND: "9",
  FLOODING: "10",
  DETOUR: "11",
  CLUSTER: "14",
} as const;

/**
 * Time validity filter options
 */
export type TimeValidityFilter = "present" | "future" | "all";

/**
 * Magnitude of delay scale (0-4)
 */
export type DelayMagnitude = 0 | 1 | 2 | 3 | 4; // 0=none, 4=severe

export interface TrafficIncidentsOptions {
  /**
   * The language to return results in (IETF language tag)
   * @default "en-GB"
   */
  language?: string;

  /**
   * Filter by time validity (present, future)
   * @default "present"
   */
  timeValidityFilter?: TimeValidityFilter;

  /**
   * Fields to include in the response using TomTom's nested field syntax
   * @default A comprehensive set of fields including incident type, geometry, and detailed properties
   * @example "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,events{description}}}}"
   */
  fields?: string;

  /**
   * Maximum number of incidents to return
   */
  maxResults?: number;

  /**
   * Incident categories to filter by (comma-separated values)
   * Use TRAFFIC_INCIDENT_CATEGORIES constants or provide custom values
   * Types: 0=Accident, 1=Fog, 2=Dangerous Conditions, 3=Rain, 4=Ice, 5=Jam/Lane Restrictions,
   * 6=Lane Closure, 7=Road Closure, 8=Road Works, 9=Wind, 10=Flooding, 11=Detour,
   * 14=Cluster
   */
  categoryFilter?: string | string[];

  /**
   * Legacy parameter - can still be used but categoryFilter is preferred
   * @deprecated Use categoryFilter instead
   */
  incidentDetailsTypes?: string;
}

export interface TrafficIncidentEvent {
  description: string; // Human-readable description of the incident
  code: number; // TomTom code for the event type
  iconCategory: number; // Icon category for this specific event
}

export interface TrafficIncidentTMC {
  countryCode?: string;
  tableNumber?: string;
  tableVersion?: string;
  direction?: string;
  points?: Array<{
    location?: string;
    offset?: string | number;
  }>;
}

export interface TrafficIncidentProperties {
  id: string; // Unique identifier for the incident
  iconCategory: number; // Icon category code representing the incident type
  magnitudeOfDelay: DelayMagnitude; // Severity of delay on scale 0-4 (0=none, 4=severe)
  events: TrafficIncidentEvent[]; // Array of events associated with this incident
  startTime?: string; // ISO datetime when the incident began
  endTime?: string; // ISO datetime when the incident is expected to end
  from?: string; // Description of incident starting location
  to?: string; // Description of incident ending location
  length?: number; // Length of affected area in meters
  delay?: number; // Delay in seconds caused by the incident
  roadNumbers?: string[]; // Road numbers affected
  timeValidity?:
    | string
    | {
        // Can be string ("present") or object with times
        startTime?: string;
        endTime?: string;
      };
  probabilityOfOccurrence?: string; // How certain the incident is (e.g., "certain")
  numberOfReports?: number | null; // Number of reports for this incident
  lastReportTime?: string | null; // ISO datetime of the last report
  aci?: any | null; // Additional incident information
  tmc?: TrafficIncidentTMC | null; // Traffic Message Channel information
}

export interface TrafficIncident {
  type: string; // Typically "Feature"
  geometry: {
    type: string; // Typically "LineString" or "Point"
    coordinates: Array<number[]>; // Array of [longitude, latitude] coordinate pairs
  };
  properties: TrafficIncidentProperties;
}

export interface TrafficIncidentsResult {
  incidents?: TrafficIncident[];
  formatVersion?: string;
  copyright?: string;
  privacy?: string;
}

/**
 * Default fields to include in traffic incidents response
 */
export const DEFAULT_FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,numberOfReports,lastReportTime,tmc{countryCode,tableNumber,tableVersion,direction,points{location,offset}}}}}";

/**
 * Default options for traffic incidents requests
 */
export const DEFAULT_OPTIONS: Required<
  Pick<TrafficIncidentsOptions, "language" | "timeValidityFilter" | "fields">
> = {
  language: "en-GB",
  timeValidityFilter: "present",
  fields: DEFAULT_FIELDS,
};
