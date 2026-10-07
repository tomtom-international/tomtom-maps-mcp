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

import type { TrafficIncidentDetails } from "@tomtom-org/maps-sdk/core";
import { describe, expect, it } from "vitest";
import {
  buildCompressedResponse,
  capTrafficIncidents,
  DEFAULT_MAX_TRAFFIC_INCIDENTS,
  trimReachableRangeResponse,
  trimRoutingResponse,
  trimSearchResponse,
  trimTrafficResponse,
  requestedSearchFields,
  requestedTrafficFields,
} from "./responseTrimmer";
import { expectDropped, expectKept, loadFixture, valuesAt } from "./__fixtures__";

type TrimmedFeatureCollection = {
  type?: string;
  queryTime?: unknown;
  geoBias?: unknown;
  features: Array<{
    geometry?: Record<string, unknown>;
    bbox?: unknown;
    properties?: Record<string, unknown>;
  }>;
};
type Incident = TrafficIncidentDetails["features"][number];

const trafficIncident = (
  properties: Partial<Incident["properties"]>,
  geometry: Incident["geometry"] = { type: "Point", coordinates: [4.9, 52.37] }
): Incident => ({
  type: "Feature",
  geometry,
  properties: {
    id: "incident",
    category: "jam",
    magnitudeOfDelay: "minor",
    events: [],
    timeValidity: "present",
    ...properties,
  },
});

const incidentsOf = (...features: Incident[]): TrafficIncidentDetails => ({
  type: "FeatureCollection",
  features,
});

describe("trimRoutingResponse", () => {
  it("should return the response unchanged when it is not a FeatureCollection", () => {
    const response = { error: "No route found" };
    expect(trimRoutingResponse(response)).toEqual(response);
  });

  it("should remove geometry, bbox, guidance and progress from each route feature", () => {
    const response = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[4.89, 52.37]] },
          bbox: [4.89, 52.37, 13.4, 52.52],
          properties: {
            summary: { lengthInMeters: 1000, travelTimeInSeconds: 600 },
            guidance: { instructions: [{ message: "Turn left" }] },
            progress: [{ pointIndex: 0 }],
          },
        },
      ],
    };

    const trimmed = trimRoutingResponse(response) as TrimmedFeatureCollection;
    const feature = trimmed.features[0];

    expect(feature.geometry!.coordinates).toBeUndefined();
    expect(feature.bbox).toBeUndefined();
    expect(feature.properties!.guidance).toBeUndefined();
    expect(feature.properties!.progress).toBeUndefined();
    expect(feature.properties!.summary).toBeDefined();
  });

  it("should strip verbose section types from the SDK GeoJSON format", () => {
    const response = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [4.89, 52.37],
              [13.4, 52.52],
            ],
          },
          properties: {
            summary: { lengthInMeters: 597786, travelTimeInSeconds: 19733 },
            sections: {
              leg: [
                { startPointIndex: 0, endPointIndex: 100, summary: { lengthInMeters: 597786 } },
              ],
              roadShields: [
                {
                  id: "rs1",
                  startPointIndex: 2,
                  endPointIndex: 69,
                  roadShieldReferences: [{ reference: "deu-primary", shieldContent: "5" }],
                },
              ],
              speedLimit: [
                { id: "sl1", startPointIndex: 0, endPointIndex: 81, maxSpeedLimitInKmh: 50 },
              ],
              urban: [{ id: "u1", startPointIndex: 0, endPointIndex: 109 }],
              tunnel: [{ id: "t1", startPointIndex: 201, endPointIndex: 204 }],
              lowEmissionZone: [{ id: "lez1", startPointIndex: 0, endPointIndex: 409 }],
              pedestrian: [{ id: "p1", startPointIndex: 6784, endPointIndex: 6789 }],
              vehicleRestricted: [{ id: "vr1", startPointIndex: 6784, endPointIndex: 6789 }],
              motorway: [{ id: "m1", startPointIndex: 430, endPointIndex: 6606 }],
              country: [
                { id: "c1", startPointIndex: 0, endPointIndex: 6789, countryCodeISO3: "DEU" },
              ],
              traffic: [
                {
                  id: "tr1",
                  startPointIndex: 422,
                  endPointIndex: 430,
                  delayInSeconds: 48,
                  magnitudeOfDelay: "minor",
                },
              ],
              importantRoadStretch: [
                {
                  id: "irs1",
                  startPointIndex: 952,
                  endPointIndex: 1821,
                  roadNumbers: ["A9", "E51"],
                },
              ],
            },
          },
        },
      ],
    };

    const trimmed = trimRoutingResponse(response) as Record<string, unknown>;
    const features = trimmed.features as Array<Record<string, unknown>>;
    const sections = (features[0].properties as Record<string, unknown>).sections as Record<
      string,
      unknown
    >;

    // Stripped sections
    expect(sections.roadShields).toBeUndefined();
    expect(sections.speedLimit).toBeUndefined();
    expect(sections.urban).toBeUndefined();
    expect(sections.tunnel).toBeUndefined();
    expect(sections.lowEmissionZone).toBeUndefined();
    expect(sections.pedestrian).toBeUndefined();
    expect(sections.vehicleRestricted).toBeUndefined();

    // Kept sections, without their point references into the removed coordinates
    expect(sections.leg).toBeDefined();
    expect(sections.country).toBeDefined();
    expect(sections.traffic).toBeDefined();
    expect(sections.importantRoadStretch).toBeDefined();
    const legs = sections.leg as Array<Record<string, unknown>>;
    expect(legs[0].startPointIndex).toBeUndefined();
    expect(legs[0].endPointIndex).toBeUndefined();

    // Motorway entries only hold point references, so nothing is left of them
    expect(sections.motorway).toBeUndefined();

    const geom = features[0].geometry as Record<string, unknown>;
    expect(geom.coordinates).toBeUndefined();
  });

  it("should trim the SDK route shape (fixture)", () => {
    const response = loadFixture("orbis-route");
    const trimmed = trimRoutingResponse(response);
    const sections = "features[].properties.sections";

    expectDropped(response, trimmed, [
      "features[].geometry.coordinates",
      "features[].bbox",
      "features[].properties.progress",
      // Map-rendering section types
      `${sections}.roadShields`,
      `${sections}.speedLimit`,
      `${sections}.urban`,
      `${sections}.tunnel`,
      `${sections}.lowEmissionZone`,
      `${sections}.vehicleRestricted`,
      // Point references into the removed coordinates
      `${sections}.leg[].id`,
      `${sections}.leg[].startPointIndex`,
      `${sections}.leg[].endPointIndex`,
      `${sections}.country[].id`,
      `${sections}.traffic[].startPointIndex`,
      `${sections}.importantRoadStretch[].endPointIndex`,
      // tec repeats categories
      `${sections}.traffic[].tec`,
      // motorway entries only hold point references, so nothing is left
      `${sections}.motorway`,
    ]);
    expectKept(trimmed, [
      "features[].properties.summary.travelTimeInSeconds",
      `${sections}.leg[].summary.lengthInMeters`,
      `${sections}.country[].countryCodeISO3`,
      `${sections}.traffic[].delayInSeconds`,
      `${sections}.traffic[].categories`,
      `${sections}.traffic[].magnitudeOfDelay`,
      `${sections}.importantRoadStretch[].roadNumbers`,
    ]);
  });
});

describe("trimSearchResponse", () => {
  const address = "features[].properties.address";

  it("should return the response unchanged when it is not GeoJSON", () => {
    const response = { error: "No results" };
    expect(trimSearchResponse(response)).toEqual(response);
  });

  it("should trim collection metadata under properties, where the SDK puts it", () => {
    const response = loadFixture("orbis-fuzzy-search");
    const trimmed = trimSearchResponse(response);

    expectDropped(response, trimmed, [
      "properties.queryTime",
      "properties.geoBias",
      // Fuzzy level is a matching internal
      "properties.fuzzyLevel",
    ]);
    // nextCursor pages on, as the tools' cursor input
    expectKept(trimmed, [
      "properties.numResults",
      "properties.totalResults",
      "properties.nextCursor",
    ]);
  });

  it("should trim place features", () => {
    const response = loadFixture("orbis-poi-search");
    const trimmed = trimSearchResponse(response);

    expectDropped(response, trimmed, [
      "features[].properties.score",
      "features[].properties.info",
      "features[].properties.entryPoints",
      "features[].properties.poi.localizedCategories",
      `${address}.countryCodeISO3`,
      `${address}.countrySubdivisionCode`,
      `${address}.countrySubdivisionName`,
      `${address}.localName`,
      `${address}.extendedPostalCode`,
    ]);
    expectKept(trimmed, [
      "features[].geometry.coordinates",
      "features[].properties.distance",
      "features[].properties.poi.name",
      "features[].properties.poi.categories",
      "features[].properties.poi.phone",
      "features[].properties.poi.brands",
      `${address}.freeformAddress`,
      `${address}.postalCode`,
      `${address}.countryCode`,
    ]);
  });

  it("should drop geocode match metadata", () => {
    const response = loadFixture("orbis-geocode");
    const trimmed = trimSearchResponse(response);

    expectDropped(response, trimmed, [
      "features[].properties.matchConfidence",
      "features[].properties.score",
      "features[].properties.entryPoints",
    ]);
    expectKept(trimmed, ["features[].geometry.coordinates", `${address}.freeformAddress`]);
  });

  it("should drop reverse geocode metadata", () => {
    const response = loadFixture("orbis-reverse-geocode");
    const trimmed = trimSearchResponse(response);

    expectDropped(response, trimmed, [
      "properties.entryPoints",
      "properties.address.countryCodeISO3",
      "properties.address.countrySubdivisionCodeIso",
    ]);
    expectKept(trimmed, ["geometry.coordinates", "properties.address.freeformAddress"]);
  });

  it("should flatten EV connectors", () => {
    const response = loadFixture("orbis-ev-search");
    const trimmed = trimSearchResponse(response);
    const park = "features[].properties.chargingPark";

    expectDropped(response, trimmed, [
      `${park}.chargingStations`,
      `${park}.connectors[].connector`,
    ]);
    expectKept(trimmed, [
      `${park}.connectors[].type`,
      `${park}.connectors[].ratedPowerKW`,
      `${park}.connectors[].currentType`,
      `${park}.connectors[].count`,
    ]);
    const first = response.features[0].properties.chargingPark.connectors[0];
    expect(valuesAt(trimmed, `${park}.connectors[]`)[0]).toEqual({
      type: first.connector.type,
      ratedPowerKW: first.connector.ratedPowerKW,
      currentType: first.connector.currentType,
      chargingSpeed: first.connector.chargingSpeed,
      count: first.count,
    });
  });

  it("should drop data source ids", () => {
    const response = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.89, 52.37] },
          properties: { type: "POI", dataSources: { poiDetails: [{ id: "poi-1" }] } },
        },
      ],
    };

    expectDropped(response, trimSearchResponse(response), ["features[].properties.dataSources"]);
  });

  it("should trim a single Feature (reverse geocode)", () => {
    const response = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.89, 52.37] },
      properties: {
        address: { freeformAddress: "123 Main St", countryCodeISO3: "NLD", localName: "Amsterdam" },
        mapcodes: [{ type: "Local", code: "ABC.XYZ" }],
      },
    };

    const trimmed = trimSearchResponse(response) as { properties: Record<string, unknown> };
    const address = trimmed.properties.address as Record<string, unknown>;

    expect(address.freeformAddress).toBe("123 Main St");
    expect(address.countryCodeISO3).toBeUndefined();
    expect(address.localName).toBeUndefined();
    expect(trimmed.properties.mapcodes).toBeUndefined();
  });
});

describe("trimTrafficResponse", () => {
  it("should drop the GeoJSON envelope and the internal id, and flatten properties", () => {
    const response = incidentsOf(
      trafficIncident(
        { id: "incident123", category: "jam", magnitudeOfDelay: "moderate", from: "A", to: "B" },
        {
          type: "LineString",
          coordinates: [
            [4.89707, 52.377956],
            [4.898, 52.378],
          ],
        }
      )
    );

    expect(trimTrafficResponse(response)).toEqual({
      incidents: [{ category: "jam", magnitudeOfDelay: "moderate", from: "A", to: "B" }],
    });
  });

  it("should round the length, list each event description once, and omit empty fields", () => {
    const response = incidentsOf(
      trafficIncident({
        category: "road-closed",
        lengthInMeters: 292.308,
        roadNumbers: [],
        events: [
          { code: 401, description: "Closed", category: "road-closed" },
          { code: 401, description: "Closed", category: "road-closed" },
          { code: 705, description: "Roadworks", category: "roadworks" },
        ],
      })
    );

    const [incident] = trimTrafficResponse(response).incidents;

    expect(incident.lengthInMeters).toBe(292);
    expect(incident).not.toHaveProperty("delayInSeconds");
    expect(incident).not.toHaveProperty("roadNumbers");
    expect(incident.events).toEqual(["Closed", "Roadworks"]);
  });

  it("should keep the incidentSummary the cap adds", () => {
    const incidents = Array.from({ length: 3 }, () => trafficIncident({}));
    const trimmed = trimTrafficResponse(capTrafficIncidents(incidentsOf(...incidents), 2));

    expect(trimmed.incidents).toHaveLength(2);
    expect(trimmed.incidentSummary).toMatchObject({ totalIncidents: 3, returnedIncidents: 2 });
  });
});

describe("capTrafficIncidents", () => {
  const ranked = (id: string, magnitudeOfDelay: Incident["properties"]["magnitudeOfDelay"]) =>
    trafficIncident({ id, magnitudeOfDelay, category: "jam" });

  it("should return the response unchanged when at or under the cap", () => {
    const response = incidentsOf(...Array.from({ length: 10 }, (_, i) => ranked(`${i}`, "minor")));
    expect(capTrafficIncidents(response)).toBe(response);
  });

  it("should keep the most severe incidents and add a summary when over the cap", () => {
    const response = incidentsOf(
      ...Array.from({ length: DEFAULT_MAX_TRAFFIC_INCIDENTS }, (_, i) =>
        ranked(`minor-${i}`, "minor")
      ),
      trafficIncident({ id: "closure", magnitudeOfDelay: "indefinite", category: "road-closed" }),
      trafficIncident({ id: "major", magnitudeOfDelay: "major", category: "accident" })
    );
    const capped = capTrafficIncidents(response);

    expect(capped.features).toHaveLength(DEFAULT_MAX_TRAFFIC_INCIDENTS);
    expect(capped.features.slice(0, 2).map((f) => f.properties.id)).toEqual(["closure", "major"]);
    expect(capped.incidentSummary).toEqual({
      totalIncidents: DEFAULT_MAX_TRAFFIC_INCIDENTS + 2,
      returnedIncidents: DEFAULT_MAX_TRAFFIC_INCIDENTS,
      truncated: true,
      incidentsByCategory: { jam: DEFAULT_MAX_TRAFFIC_INCIDENTS, "road-closed": 1, accident: 1 },
      note: expect.stringContaining(`of ${DEFAULT_MAX_TRAFFIC_INCIDENTS + 2} incidents`),
    });
  });

  it("should order unknown below minor and respect a caller-provided cap", () => {
    const response = incidentsOf(ranked("unknown", "unknown"), ranked("minor", "minor"));
    const capped = capTrafficIncidents(response, 1);

    expect(capped.features.map((f) => f.properties.id)).toEqual(["minor"]);
    expect(capped.incidentSummary).toMatchObject({ totalIncidents: 2, returnedIncidents: 1 });
  });
});

describe("requested fields (fixtures)", () => {
  const allRequested = requestedSearchFields({
    openingHours: "nextSevenDays",
    timeZone: "iana",
    mapcodes: ["Local"],
    extendedPostalCodesFor: "POI,PAD",
  });

  it("should read which optional fields the tool parameters ask for", () => {
    expect(allRequested).toEqual({
      openingHours: true,
      timeZone: true,
      mapcodes: true,
      extendedPostalCode: true,
      relatedPois: false,
      addressRanges: false,
    });
    expect(requestedSearchFields({ mapcodes: [], relatedPois: "off" })).toEqual({
      openingHours: false,
      timeZone: false,
      mapcodes: false,
      extendedPostalCode: false,
      relatedPois: false,
      addressRanges: false,
    });
    expect(requestedSearchFields({ relatedPois: "child", addressRanges: true })).toEqual(
      expect.objectContaining({ relatedPois: true, addressRanges: true })
    );
    expect(requestedTrafficFields()).toEqual({ timeValidity: false });
    expect(requestedTrafficFields(["present"])).toEqual({ timeValidity: false });
    expect(requestedTrafficFields(["future"])).toEqual({ timeValidity: true });
    expect(requestedTrafficFields(["present", "future"])).toEqual({ timeValidity: true });
  });

  it("should keep openingHours, timeZone, mapcodes and extendedPostalCode only when requested", () => {
    const response = loadFixture("orbis-poi-search-requested");
    const paths = [
      "features[].properties.poi.openingHours",
      "features[].properties.poi.timeZone",
      "features[].properties.mapcodes",
      "features[].properties.address.extendedPostalCode",
    ];

    expectDropped(response, trimSearchResponse(response), paths);
    expectKept(trimSearchResponse(response, allRequested), paths);
  });

  it("should keep traffic timeValidity only when the filter asks for future incidents", () => {
    const response = loadFixture("orbis-traffic");

    expect(valuesAt(response, "features[].properties.timeValidity")).not.toEqual([]);
    expect(valuesAt(trimTrafficResponse(response), "incidents[].timeValidity")).toEqual([]);
    const kept = trimTrafficResponse(response, requestedTrafficFields(["present", "future"]));
    expect(valuesAt(kept, "incidents[].timeValidity")).toEqual(
      valuesAt(response, "features[].properties.timeValidity")
    );
  });
});

describe("trimReachableRangeResponse", () => {
  it("should keep the range's budget and origin, and nothing else from its properties (fixture)", () => {
    const response = loadFixture("orbis-reachable-range");
    const trimmed = trimReachableRangeResponse(response);

    expectDropped(response, trimmed, [
      "features[].geometry.coordinates",
      "features[].properties.apiKey",
      "features[].properties.commonBaseURL",
      "features[].properties.retry",
      "bbox",
    ]);
    expect(valuesAt(trimmed, "features[].properties")).toEqual(
      response.features.map((f: { properties: { budget: unknown; origin: unknown } }) => ({
        budget: f.properties.budget,
        origin: f.properties.origin,
      }))
    );
    expect(JSON.stringify(trimmed)).not.toContain("test-api-key");
  });

  it("should remove boundaries and bbox, and keep only budget and origin", () => {
    const response = {
      type: "FeatureCollection",
      bbox: [4.8, 52.3, 5.0, 52.4],
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4.8, 52.4],
                [5.0, 52.4],
                [5.0, 52.3],
                [4.8, 52.4],
              ],
            ],
          },
          properties: { budget: { type: "timeMinutes", value: 30 }, origin: [4.89707, 52.377956] },
        },
      ],
    };

    const trimmed = trimReachableRangeResponse(response) as TrimmedFeatureCollection & {
      bbox?: unknown;
    };

    expect(trimmed.bbox).toBeUndefined();
    expect(trimmed.features[0].geometry!.type).toBe("Polygon");
    expect(trimmed.features[0].geometry!.coordinates).toBeUndefined();
    expect(trimmed.features[0].properties).toEqual({
      budget: { type: "timeMinutes", value: 30 },
      origin: [4.89707, 52.377956],
    });
    expect(response.features[0].geometry.coordinates).toHaveLength(1);
  });

  it("should return original response if it is not GeoJSON", () => {
    const response = { error: "Could not calculate range" };
    const trimmed = trimReachableRangeResponse(response);
    expect(trimmed).toEqual(response);
  });
});

describe("buildCompressedResponse", () => {
  it("should build MCP response with viz_id when show_ui is true", async () => {
    const trimmedData = { summary: { query: "test" } };
    const fullData = { summary: { query: "test", queryTime: 42 }, results: [] };

    const response = await buildCompressedResponse(trimmedData, fullData, true);

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.summary.query).toBe("test");
    expect(parsed._meta.show_ui).toBe(true);
    expect(parsed._meta.viz_id).toBeDefined();
    expect(typeof parsed._meta.viz_id).toBe("string");
    expect(parsed._meta.viz_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("should serialize minified JSON", async () => {
    const trimmedData = { summary: { query: "test" }, results: [{ id: "1" }] };

    const hidden = await buildCompressedResponse(trimmedData, trimmedData, false);
    expect(hidden.content[0].text).toBe(
      JSON.stringify({ ...trimmedData, _meta: { show_ui: false } })
    );

    const shown = await buildCompressedResponse(trimmedData, trimmedData, true);
    expect(shown.content[0].text).not.toMatch(/\n|": /);
  });

  it("should build MCP response without viz_id when show_ui is false", async () => {
    const trimmedData = { summary: { query: "test" } };
    const fullData = { summary: { query: "test", queryTime: 42 }, results: [] };

    const response = await buildCompressedResponse(trimmedData, fullData, false);

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed._meta.show_ui).toBe(false);
    expect(parsed._meta.viz_id).toBeUndefined();
  });

  it("should default to show_ui true", async () => {
    const trimmedData = { data: "test" };
    const fullData = { data: "test", extra: "info" };

    const response = await buildCompressedResponse(trimmedData, fullData);

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed._meta.show_ui).toBe(true);
    expect(parsed._meta.viz_id).toBeDefined();
  });

  it("should preserve trimmed data in response", async () => {
    const trimmedData = {
      summary: { query: "Amsterdam", numResults: 5 },
      results: [{ id: "1", name: "Place 1" }],
    };
    const fullData = {
      summary: { query: "Amsterdam", numResults: 5, queryTime: 100 },
      results: [{ id: "1", name: "Place 1", extraData: "lots of stuff" }],
    };

    const response = await buildCompressedResponse(trimmedData, fullData, true);

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.summary.query).toBe("Amsterdam");
    expect(parsed.summary.numResults).toBe(5);
    expect(parsed.results[0].id).toBe("1");
    expect(parsed.results[0].name).toBe("Place 1");
    expect(parsed.summary.queryTime).toBeUndefined();
  });
});
