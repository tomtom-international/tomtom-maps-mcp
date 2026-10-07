/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { Place, Places, Routes } from "@tomtom-org/maps-sdk/core";
import type { Feature, Polygon } from "geojson";

/** What a result puts on the map. */
export interface MapContent {
  places: Place[];
  routes?: Routes;
  /** The area an area search covered. */
  boundary?: Feature<Polygon>;
  /** A reverse-geocoded position: flown to, as a box around one point says nothing. */
  single?: boolean;
}

/** Search along route's result. */
type AlongRoute = { route?: Routes; pois?: Places };

/** The result shapes the tools send, as the app reads them. */
export type ToolData =
  | Place
  | (Places & { _searchBoundary?: Feature<Polygon> })
  | Routes
  | AlongRoute;

type AnyFeature = { geometry?: { type?: string } | null };

const isAlongRoute = (data: ToolData): data is AlongRoute => "route" in data || "pois" in data;

const isPlace = (data: ToolData): data is Place => (data as { type?: string }).type === "Feature";

const isRouteFeature = (feature: AnyFeature) =>
  feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString";

/**
 * Reads a result by its shape:
 * - search along route sends `{ route, pois }`;
 * - reverse geocode sends one Place, without properties where no address is near;
 * - routing sends route lines, the search tools points, and area search adds its boundary.
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
  const boundary = (data as { _searchBoundary?: Feature<Polygon> })._searchBoundary;
  return { places: features as Place[], ...(boundary ? { boundary } : {}) };
}
