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

import { describe, it, expect } from "vitest";
import {
  trimRoutingResponse,
  trimSearchResponse,
  trimTrafficResponse,
  trimReachableRangeResponse,
  buildCompressedResponse,
  capTrafficIncidents,
  DEFAULT_MAX_TRAFFIC_INCIDENTS,
} from "./responseTrimmer";

type TrimmedRoute = {
  routes?: Array<{
    legs?: Array<{ points?: unknown; summary?: unknown }>;
    summary?: unknown;
    guidance?: unknown;
    sections?: Array<{ sectionType: string; travelMode: string }>;
  }>;
};
type TrimmedSearch = {
  summary?: Record<string, unknown>;
  results?: Array<{
    type?: string;
    id?: string;
    poi?: Record<string, unknown>;
    address?: Record<string, unknown>;
    dataSources?: unknown;
    matchConfidence?: unknown;
    info?: unknown;
    viewport?: unknown;
    boundingBox?: unknown;
  }>;
  addresses?: Array<{
    address?: Record<string, unknown>;
    position?: string;
    mapcodes?: unknown;
    matchType?: unknown;
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
  it("should remove points from legs", () => {
    const response = {
      routes: [
        {
          summary: { lengthInMeters: 1000, travelTimeInSeconds: 600 },
          legs: [
            {
              points: [
                { latitude: 52.377956, longitude: 4.89707 },
                { latitude: 52.520008, longitude: 13.404954 },
              ],
              summary: { lengthInMeters: 1000 },
            },
          ],
        },
      ],
    };

    const trimmed = trimRoutingResponse(response) as TrimmedRoute;

    expect(trimmed.routes![0].legs![0].points).toBeUndefined();
    expect(trimmed.routes![0].legs![0].summary).toBeDefined();
    expect(trimmed.routes![0].summary).toBeDefined();
  });

  it("should remove guidance from routes", () => {
    const response = {
      routes: [
        {
          summary: { lengthInMeters: 1000 },
          guidance: {
            instructions: [{ message: "Turn left" }, { message: "Turn right" }],
          },
          legs: [],
        },
      ],
    };

    const trimmed = trimRoutingResponse(response) as TrimmedRoute;

    expect(trimmed.routes![0].guidance).toBeUndefined();
    expect(trimmed.routes![0].summary).toBeDefined();
  });

  it("should return original response if no routes", () => {
    const response = { error: "No route found" };
    const trimmed = trimRoutingResponse(response);
    expect(trimmed).toEqual(response);
  });

  it("should preserve sections (useful for travelMode info)", () => {
    const response = {
      routes: [
        {
          sections: [{ sectionType: "TRAVEL_MODE", travelMode: "car" }],
          legs: [],
        },
      ],
    };

    const trimmed = trimRoutingResponse(response) as TrimmedRoute;

    expect(trimmed.routes![0].sections).toBeDefined();
    expect(trimmed.routes![0].sections![0].travelMode).toBe("car");
  });

  it("should strip verbose section types from SDK/Orbis GeoJSON format", () => {
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
  it("should remove queryTime, fuzzyLevel, offset, geoBias from summary", () => {
    const response = {
      summary: {
        query: "Amsterdam",
        queryType: "NON_NEAR",
        queryTime: 42,
        numResults: 10,
        offset: 0,
        totalResults: 100,
        fuzzyLevel: 2,
        geoBias: { lat: 52.3, lon: 4.9 },
      },
      results: [],
    };

    const trimmed = trimSearchResponse(response) as TrimmedSearch;

    expect(trimmed.summary!.query).toBe("Amsterdam");
    expect(trimmed.summary!.numResults).toBe(10);
    expect(trimmed.summary!.queryTime).toBeUndefined();
    expect(trimmed.summary!.offset).toBeUndefined();
    expect(trimmed.summary!.fuzzyLevel).toBeUndefined();
    expect(trimmed.summary!.geoBias).toBeUndefined();
  });

  it("should remove POI verbose fields", () => {
    const response = {
      results: [
        {
          type: "POI",
          poi: {
            name: "Coffee Shop",
            phone: "+1234567890",
            classifications: [{ code: "CAFE", names: [{ name: "Cafe" }] }],
            openingHours: { mode: "nextSevenDays", timeRanges: [] },
            categorySet: [{ id: 123 }],
            timeZone: { ianaId: "Europe/Amsterdam" },
          },
          address: { freeformAddress: "123 Main St" },
        },
      ],
    };

    const trimmed = trimSearchResponse(response) as TrimmedSearch;

    expect(trimmed.results![0].poi!.name).toBe("Coffee Shop");
    expect(trimmed.results![0].poi!.phone).toBe("+1234567890");
    expect(trimmed.results![0].poi!.classifications).toBeUndefined();
    expect(trimmed.results![0].poi!.openingHours).toBeUndefined();
    expect(trimmed.results![0].poi!.categorySet).toBeUndefined();
    expect(trimmed.results![0].poi!.timeZone).toBeUndefined();
  });

  it("should remove brands for genesis backend", () => {
    const response = {
      results: [
        {
          poi: {
            name: "Starbucks",
            brands: [{ name: "Starbucks" }],
          },
        },
      ],
    };

    const trimmed = trimSearchResponse(response, "genesis") as TrimmedSearch;

    expect(trimmed.results![0].poi!.name).toBe("Starbucks");
    expect(trimmed.results![0].poi!.brands).toBeUndefined();
  });

  it("should remove features for orbis backend", () => {
    const response = {
      results: [
        {
          poi: {
            name: "Restaurant",
            features: [{ category: "dining" }],
          },
        },
      ],
    };

    const trimmed = trimSearchResponse(response, "orbis") as TrimmedSearch;

    expect(trimmed.results![0].poi!.name).toBe("Restaurant");
    expect(trimmed.results![0].poi!.features).toBeUndefined();
  });

  it("should remove metadata fields from results", () => {
    const response = {
      results: [
        {
          type: "POI",
          id: "abc123",
          dataSources: { geometry: { id: "geo123" } },
          matchConfidence: { score: 0.95 },
          info: "internal-ref",
          viewport: { topLeftPoint: {}, btmRightPoint: {} },
          boundingBox: { topLeftPoint: {}, btmRightPoint: {} },
          address: { freeformAddress: "123 Main St" },
        },
      ],
    };

    const trimmed = trimSearchResponse(response) as TrimmedSearch;

    expect(trimmed.results![0].id).toBe("abc123");
    expect(trimmed.results![0].address).toBeDefined();
    expect(trimmed.results![0].dataSources).toBeUndefined();
    expect(trimmed.results![0].matchConfidence).toBeUndefined();
    expect(trimmed.results![0].info).toBeUndefined();
    expect(trimmed.results![0].viewport).toBeUndefined();
    expect(trimmed.results![0].boundingBox).toBeUndefined();
  });

  it("should remove redundant address fields", () => {
    const response = {
      results: [
        {
          address: {
            freeformAddress: "123 Main St, Amsterdam",
            streetName: "Main St",
            municipality: "Amsterdam",
            countryCode: "NL",
            countryCodeISO3: "NLD",
            countrySubdivision: "North Holland",
            countrySubdivisionCode: "NH",
            countrySubdivisionName: "North Holland",
            localName: "Amsterdam",
          },
        },
      ],
    };

    const trimmed = trimSearchResponse(response) as TrimmedSearch;

    expect(trimmed.results![0].address!.freeformAddress).toBe("123 Main St, Amsterdam");
    expect(trimmed.results![0].address!.countryCode).toBe("NL");
    expect(trimmed.results![0].address!.countryCodeISO3).toBeUndefined();
    expect(trimmed.results![0].address!.countrySubdivisionCode).toBeUndefined();
    expect(trimmed.results![0].address!.countrySubdivisionName).toBeUndefined();
    expect(trimmed.results![0].address!.localName).toBeUndefined();
  });

  it("should trim addresses array for reverse geocoding", () => {
    const response = {
      addresses: [
        {
          address: {
            freeformAddress: "123 Main St",
            countryCodeISO3: "NLD",
            countrySubdivisionCode: "NH",
            localName: "Amsterdam",
            boundingBox: { topLeftPoint: {}, btmRightPoint: {} },
          },
          position: "52.377956,4.89707",
          mapcodes: [{ type: "Local", code: "ABC.XYZ" }],
          matchType: "Street",
        },
      ],
    };

    const trimmed = trimSearchResponse(response) as TrimmedSearch;

    expect(trimmed.addresses![0].address!.freeformAddress).toBe("123 Main St");
    expect(trimmed.addresses![0].position).toBe("52.377956,4.89707");
    expect(trimmed.addresses![0].address!.countryCodeISO3).toBeUndefined();
    expect(trimmed.addresses![0].address!.boundingBox).toBeUndefined();
    expect(trimmed.addresses![0].mapcodes).toBeUndefined();
    expect(trimmed.addresses![0].matchType).toBeUndefined();
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
