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

import { describe, expect, it } from "vitest";
import {
  buildCompressedResponse,
  capTrafficIncidents,
  DEFAULT_MAX_TRAFFIC_INCIDENTS,
  trimReachableRangeResponse,
  trimRoutingResponse,
  trimSearchResponse,
  trimTrafficResponse,
} from "./responseTrimmer";

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
type TrimmedTraffic = {
  incidents?: Array<Record<string, unknown>>;
  incidentSummary?: Record<string, unknown>;
};
type TrimmedReachableRange = {
  reachableRange?: { center?: { latitude: number; longitude: number }; boundary?: unknown[] };
};

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

    // Kept sections
    expect(sections.leg).toBeDefined();
    expect(sections.motorway).toBeDefined();
    expect(sections.country).toBeDefined();
    expect(sections.traffic).toBeDefined();
    expect(sections.importantRoadStretch).toBeDefined();

    // Geometry should be removed
    const geom = features[0].geometry as Record<string, unknown>;
    expect(geom.coordinates).toBeUndefined();
  });
});

describe("trimSearchResponse", () => {
  it("should return the response unchanged when it is not GeoJSON", () => {
    const response = { error: "No results" };
    expect(trimSearchResponse(response)).toEqual(response);
  });

  it("should remove collection-level query metadata", () => {
    const response = {
      type: "FeatureCollection",
      numResults: 10,
      queryTime: 42,
      geoBias: { lat: 52.3, lon: 4.9 },
      features: [],
    };

    const trimmed = trimSearchResponse(response) as TrimmedFeatureCollection & {
      numResults?: number;
    };

    expect(trimmed.numResults).toBe(10);
    expect(trimmed.queryTime).toBeUndefined();
    expect(trimmed.geoBias).toBeUndefined();
  });

  it("should trim verbose POI, metadata and address fields from each feature", () => {
    const response = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.89, 52.37] },
          properties: {
            poi: {
              name: "Coffee Shop",
              phone: "+1234567890",
              classifications: [{ code: "CAFE" }],
              openingHours: { mode: "nextSevenDays" },
              categorySet: [{ id: 123 }],
              timeZone: { ianaId: "Europe/Amsterdam" },
              brands: [{ name: "Starbucks" }],
              features: [{ category: "dining" }],
            },
            address: {
              freeformAddress: "123 Main St, Amsterdam",
              countryCode: "NL",
              countryCodeISO3: "NLD",
              countrySubdivisionCode: "NH",
              countrySubdivisionName: "North Holland",
              localName: "Amsterdam",
              extendedPostalCode: "1011 AB-01",
            },
            dataSources: { geometry: { id: "geo123" } },
            matchConfidence: { score: 0.95 },
            info: "internal-ref",
            score: 4.2,
            viewport: {},
            boundingBox: {},
            mapcodes: [{ type: "Local" }],
          },
        },
      ],
    };

    const trimmed = trimSearchResponse(response) as TrimmedFeatureCollection;
    const props = trimmed.features[0].properties!;
    const poi = props.poi as Record<string, unknown>;
    const address = props.address as Record<string, unknown>;

    // Kept
    expect(poi.name).toBe("Coffee Shop");
    expect(poi.phone).toBe("+1234567890");
    expect(address.freeformAddress).toBe("123 Main St, Amsterdam");
    expect(address.countryCode).toBe("NL");

    // Trimmed
    expect(poi.classifications).toBeUndefined();
    expect(poi.openingHours).toBeUndefined();
    expect(poi.categorySet).toBeUndefined();
    expect(poi.timeZone).toBeUndefined();
    expect(poi.brands).toBeUndefined();
    expect(poi.features).toBeUndefined();
    expect(address.countryCodeISO3).toBeUndefined();
    expect(address.countrySubdivisionCode).toBeUndefined();
    expect(address.countrySubdivisionName).toBeUndefined();
    expect(address.localName).toBeUndefined();
    expect(address.extendedPostalCode).toBeUndefined();
    expect(props.dataSources).toBeUndefined();
    expect(props.matchConfidence).toBeUndefined();
    expect(props.info).toBeUndefined();
    expect(props.score).toBeUndefined();
    expect(props.viewport).toBeUndefined();
    expect(props.boundingBox).toBeUndefined();
    expect(props.mapcodes).toBeUndefined();
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
  it("should drop the GeoJSON envelope (type/geometry/id) and flatten properties", () => {
    const response = {
      incidents: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [4.89707, 52.377956],
              [4.898, 52.378],
              [4.899, 52.3781],
            ],
          },
          properties: {
            id: "incident123",
            iconCategory: 6,
            magnitudeOfDelay: 2,
            from: "Main St",
            to: "Second Ave",
          },
        },
      ],
    };

    const incident = (trimTrafficResponse(response) as TrimmedTraffic).incidents![0];

    // Envelope and internal id are dropped; agent fields are flat on the incident
    expect(incident.type).toBeUndefined();
    expect(incident.geometry).toBeUndefined();
    expect(incident.id).toBeUndefined();
    expect(incident.properties).toBeUndefined();
    expect(incident.iconCategory).toBe(6);
    expect(incident.magnitudeOfDelay).toBe(2);
    expect(incident.from).toBe("Main St");
    expect(incident.to).toBe("Second Ave");
  });

  it("should round length, flatten events, and omit null/empty fields", () => {
    const response = {
      incidents: [
        {
          properties: {
            iconCategory: 8,
            length: 292.308,
            delay: null,
            roadNumbers: [],
            events: [
              { code: 401, description: "Closed", iconCategory: 8 },
              { code: 401, description: "Closed", iconCategory: 8 },
              { code: 705, description: "Roadworks", iconCategory: 8 },
            ],
          },
        },
      ],
    };

    const incident = (trimTrafficResponse(response) as TrimmedTraffic).incidents![0];

    expect(incident.length).toBe(292); // rounded
    expect(incident.delay).toBeUndefined(); // null omitted
    expect(incident.roadNumbers).toBeUndefined(); // empty omitted
    expect(incident.events).toEqual(["Closed", "Roadworks"]); // deduped descriptions
  });

  it("should preserve a sibling incidentSummary added by the cap", () => {
    const response = {
      incidents: [{ properties: { iconCategory: 1 } }],
      incidentSummary: { totalIncidents: 500, truncated: true },
    };

    const trimmed = trimTrafficResponse(response) as TrimmedTraffic;
    expect(trimmed.incidentSummary).toEqual({ totalIncidents: 500, truncated: true });
  });

  it("should return original response if no incidents", () => {
    const response = { error: "No incidents found" };
    const trimmed = trimTrafficResponse(response);
    expect(trimmed).toEqual(response);
  });
});

describe("capTrafficIncidents", () => {
  // capTrafficIncidents runs on the raw response (before trimming), so incidents
  // still carry their nested `properties`.
  type CappedTraffic = {
    incidents?: Array<{ properties?: Record<string, unknown> }>;
    incidentSummary?: {
      totalIncidents: number;
      returnedIncidents: number;
      truncated: boolean;
      incidentsByIconCategory: Record<string, number>;
      note: string;
    };
  };

  const makeIncident = (id: string, magnitudeOfDelay: number, iconCategory = 6) => ({
    type: "Feature",
    properties: { id, magnitudeOfDelay, iconCategory },
  });

  it("should return the response unchanged when at or under the cap", () => {
    const response = {
      incidents: Array.from({ length: 10 }, (_, i) => makeIncident(`inc-${i}`, 1)),
    };
    const capped = capTrafficIncidents(response) as CappedTraffic;
    expect(capped.incidents).toHaveLength(10);
    expect(capped.incidentSummary).toBeUndefined();
    expect(capped).toBe(response);
  });

  it("should keep the most severe incidents and add a summary when over the cap", () => {
    const incidents = [
      ...Array.from({ length: DEFAULT_MAX_TRAFFIC_INCIDENTS }, (_, i) =>
        makeIncident(`minor-${i}`, 1, 6)
      ),
      makeIncident("closure", 4, 8),
      makeIncident("major", 3, 1),
    ];
    const capped = capTrafficIncidents({ incidents }) as CappedTraffic;

    expect(capped.incidents).toHaveLength(DEFAULT_MAX_TRAFFIC_INCIDENTS);
    // Most severe incidents survive the cut
    expect(capped.incidents![0].properties!.id).toBe("closure");
    expect(capped.incidents![1].properties!.id).toBe("major");

    expect(capped.incidentSummary).toEqual({
      totalIncidents: DEFAULT_MAX_TRAFFIC_INCIDENTS + 2,
      returnedIncidents: DEFAULT_MAX_TRAFFIC_INCIDENTS,
      truncated: true,
      incidentsByIconCategory: { "6": DEFAULT_MAX_TRAFFIC_INCIDENTS, "8": 1, "1": 1 },
      note: expect.stringContaining(`of ${DEFAULT_MAX_TRAFFIC_INCIDENTS + 2} incidents`),
    });
  });

  it("should respect a caller-provided maxIncidents", () => {
    const incidents = Array.from({ length: 30 }, (_, i) => makeIncident(`inc-${i}`, i % 5));
    const capped = capTrafficIncidents({ incidents }, 10) as CappedTraffic;

    expect(capped.incidents).toHaveLength(10);
    expect(capped.incidentSummary!.totalIncidents).toBe(30);
    expect(capped.incidentSummary!.returnedIncidents).toBe(10);
  });

  it("should return the response unchanged when incidents are missing", () => {
    const response = { error: "No incidents found" };
    expect(capTrafficIncidents(response)).toBe(response);
  });
});

describe("trimReachableRangeResponse", () => {
  it("should remove boundary from reachableRange", () => {
    const response = {
      reachableRange: {
        center: { latitude: 52.377956, longitude: 4.89707 },
        boundary: [
          { latitude: 52.4, longitude: 4.8 },
          { latitude: 52.4, longitude: 5.0 },
          { latitude: 52.3, longitude: 5.0 },
          { latitude: 52.3, longitude: 4.8 },
        ],
      },
    };

    const trimmed = trimReachableRangeResponse(response) as TrimmedReachableRange;

    expect(trimmed.reachableRange!.center).toBeDefined();
    expect(trimmed.reachableRange!.center!.latitude).toBe(52.377956);
    expect(trimmed.reachableRange!.boundary).toBeUndefined();
  });

  it("should return original response if no reachableRange", () => {
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
    // viz_id should be a UUID format
    expect(parsed._meta.viz_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    // Should not have _compressed (old format)
    expect(parsed._meta._compressed).toBeUndefined();
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
    // Trimmed data should not have queryTime
    expect(parsed.summary.queryTime).toBeUndefined();
  });
});
