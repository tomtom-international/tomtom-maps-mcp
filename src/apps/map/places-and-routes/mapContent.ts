/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { Place, Places, Routes } from "@tomtom-org/maps-sdk/core";
import type { Feature, MultiPolygon, Polygon } from "geojson";

/** The outline of every area a search covered, several areas as one MultiPolygon. */
export type SearchBoundary = Feature<Polygon | MultiPolygon>;

/** What a result puts on the map. */
export interface MapContent {
  places: Place[];
  routes?: Routes;
  /** The areas a `within` search covered, or a `nearby` search's circle. */
  boundary?: SearchBoundary;
  /** A reverse-geocoded position: flown to, as a box around one point says nothing. */
  single?: boolean;
}

/** A `within` or `nearby` search's places, with the outline of what it covered. */
export type AreaSearch = Places & { _searchBoundary?: SearchBoundary };

/** A `maxDetour` search: the route it planned, and the places along it. */
export type AlongRoute = { route?: Routes; pois?: Places };

/** The result shapes the tools send, as the app reads them. */
export type ToolData = Place | AreaSearch | Routes | AlongRoute;

type AnyFeature = { geometry?: { type?: string } | null };

const isAlongRoute = (data: ToolData): data is AlongRoute => "route" in data || "pois" in data;

const isPlace = (data: ToolData): data is Place => (data as { type?: string }).type === "Feature";

const isRouteFeature = (feature: AnyFeature) =>
  feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString";

/**
 * Reads a result by its shape:
 * - a `maxDetour` search sends `{ route, pois }`;
 * - reverse geocode sends one Place, without properties where no address is near;
 * - routing sends route lines, the search tools points, and a `within` or `nearby` search adds its outline.
 */
export function toMapContent(data: ToolData): MapContent {
  if (isAlongRoute(data)) {
    return { places: data.pois?.features ?? [], routes: data.route };
  }
  if (isPlace(data)) {
    return { places: data.geometry && data.properties ? [data] : [], single: true };
  }
  const features: AnyFeature[] = data.features ?? [];
  if (features.some(isRouteFeature)) return { places: [], routes: data as Routes };
  const boundary = (data as AreaSearch)._searchBoundary;
  return { places: features as Place[], ...(boundary ? { boundary } : {}) };
}
