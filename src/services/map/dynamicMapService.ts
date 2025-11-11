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

import { tomtomClient, validateApiKey, CONFIG } from "../base/tomtomClient";
import axios from "axios";
import { logger } from "../../utils/logger";
import { DynamicMapOptions, DynamicMapResponse } from "./dynamicMapTypes";
import { getRoute, getMultiWaypointRoute } from "../routing/routingService";
import { RouteOptions } from "../routing/types";

// Import geometry and GeoJSON utilities
import { calculateEnhancedBounds, generateCirclePoints, extractCoordinates } from './geometryUtils';

  // Conditionally import MapLibre GL Native and Canvas
  // These will be undefined if the packages are not installed
  let mbgl: any;
  let createCanvas: any;
  
  // Only attempt to import these dependencies if dynamic maps are enabled
  if (process.env.ENABLE_DYNAMIC_MAPS !== "false") {
  try {
    // Dynamic imports for MapLibre GL Native and Canvas
    const importMapLibre = async () => {
      try {
        return await import("@maplibre/maplibre-gl-native");
      } catch (error) {
        logger.warn("⚠️ MapLibre GL Native not available: dynamic maps will not function");
        return undefined;
      }
    };
    
    const importCanvas = async () => {
      try {
        return await import("canvas");
      } catch (error) {
        logger.warn("⚠️ Canvas library not available: dynamic maps will not function");
        return undefined;
      }
    };
    
    // Execute imports immediately and synchronously
    Promise.all([importMapLibre(), importCanvas()])
      .then(([maplibreModule, canvasModule]) => {
        mbgl = maplibreModule?.default;
        createCanvas = canvasModule?.createCanvas;
        
        if (mbgl && createCanvas) {
          logger.info("✅ Dynamic map dependencies loaded successfully");
        } else {
          logger.warn("⚠️ Some dynamic map dependencies could not be loaded");
        }
      })
      .catch((error) => {
        logger.error(`❌ Error loading dynamic map dependencies: ${error.message}`);
      });
  } catch (error: any) {
    logger.error(`❌ Failed to import dynamic map dependencies: ${error.message}`);
  }
}

/**
 * Dynamic Map Service
 * Provides advanced map rendering capabilities using MapLibre GL Native, Turf.js, and Canvas
 */

/**
 * Format time in seconds to human-readable format
 */
function formatTime(seconds: number): string {
  if (!seconds || seconds < 60) {
    return `${Math.round(seconds || 0)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

/**
 * Format distance in meters to human-readable format
 */
function formatDistance(meters: number): string {
  if (!meters || meters < 1000) {
    return `${Math.round(meters || 0)}m`;
  } else if (meters < 100000) {
    return `${(meters / 1000).toFixed(1)}km`;
  } else {
    return `${Math.round(meters / 1000)}km`;
  }
}

/**
 * Get traffic color based on delay percentage
 */
function getTrafficColor(travelTime: number, trafficDelay: number): string {
  if (!trafficDelay || trafficDelay <= 0) return "#22c55e"; // Green - no traffic

  const delayPercentage = (trafficDelay / travelTime) * 100;

  if (delayPercentage < 10) return "#84cc16"; // Light green - light traffic
  if (delayPercentage < 25) return "#eab308"; // Yellow - moderate traffic
  if (delayPercentage < 50) return "#f97316"; // Orange - heavy traffic
  return "#ef4444"; // Red - severe delays
}

/**
 * Default options for dynamic map rendering
 */
const DEFAULT_DYNAMIC_MAP_OPTIONS = {
  width: 800,
  height: 600,
  showLabels: false,
  routeInfoDetail: "basic" as const,
};

/**
 * Fetch dynamic copyright text based on map style
 */
async function fetchCopyrightCaption(useOrbis: boolean): Promise<string> {
  try {
    let copyrightUrl: string;
    let requestParams: any = {};
    
    if (useOrbis) {
      copyrightUrl = 'maps/orbis/copyrights/caption.json';
      requestParams = { apiVersion: 1 };
    } else {
      copyrightUrl = 'map/2/copyrights/caption.json';
      // No additional params needed for Genesis
    }

    const response = await tomtomClient.get(copyrightUrl, {
      responseType: 'json',
      params: requestParams
    });

    if (response.data && response.data.copyrightsCaption) {
      return response.data.copyrightsCaption;
    } else {
      // Fallback to static text if API call fails
      return useOrbis ? '©TomTom, ©OpenStreetMap' : '©TomTom';
    }
  } catch (error: any) {
    logger.warn(`Failed to fetch copyright caption: ${error.message}. Using fallback.`);
    // Fallback to static text if API call fails
    return useOrbis ? '©TomTom, ©OpenStreetMap' : '©TomTom';
  }
}

/**
 * Validate and sanitize coordinate values
 */
function validateCoordinate(value: any, type: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid ${type} coordinate: ${value}`);
  }

  if (type === "latitude" && (num < -90 || num > 90)) {
    throw new Error(`Latitude out of range [-90, 90]: ${num}`);
  }

  if (type === "longitude" && (num < -180 || num > 180)) {
    throw new Error(`Longitude out of range [-180, 180]: ${num}`);
  }

  return num;
}
/**
 * Render a dynamic map using MapLibre GL Native (adapted from original renderMap function)
 */
async function renderMapWithMapLibre(options: any): Promise<Buffer> {
  const {
    bbox,
    width,
    height,
    markers,
    routes,
    polygons,
    routeData,
    showLabels,
    routeLabel,
    useOrbis,
  } = options;

  let bounds: any, center: any, zoom: number;

  // Calculate enhanced bounds (adapted from original implementation)
  if (bbox && Array.isArray(bbox) && bbox.length === 4) {
    try {
      const providedBounds = {
        west: validateCoordinate(bbox[0], "longitude"),
        south: validateCoordinate(bbox[1], "latitude"),
        east: validateCoordinate(bbox[2], "longitude"),
        north: validateCoordinate(bbox[3], "latitude"),
      };

      if (
        providedBounds.west >= providedBounds.east ||
        providedBounds.south >= providedBounds.north
      ) {
        throw new Error(`Invalid bounds: west must be < east and south must be < north`);
      }

      const result = calculateEnhancedBounds(
        [
          { lat: providedBounds.south, lon: providedBounds.west },
          { lat: providedBounds.north, lon: providedBounds.east },
        ],
        [],
        width,
        height,
        []
      );

      bounds = result.bounds;
      center = result.center;
      zoom = result.zoom;
    } catch (error: any) {
      logger.warn(`⚠️ Invalid bbox: ${error.message}. Calculating from markers/routes.`);
      const result = calculateEnhancedBounds(markers, routes, width, height, polygons);
      bounds = result.bounds;
      center = result.center;
      zoom = result.zoom;
    }
  } else {
    const result = calculateEnhancedBounds(markers, routes, width, height, polygons);
    bounds = result.bounds;
    center = result.center;
    zoom = result.zoom;
  }

  // Fetch TomTom style (adapted from original)
  const STYLE_VERSION = "22.3.0-1";
  const MAP_STYLE = "basic_main";

  // Check environment to determine if Orbis should be used

  let styleUrl: string;
  let styleParams: any = {};
  
  if (useOrbis) {
    styleUrl = `maps/orbis/assets/styles/0.5.0-0/style.json`;
    styleParams = { apiVersion: 1, map: 'basic_street-light' };
    logger.info(`🌍 Using TomTom Orbis style endpoint`);
  } else {
    styleUrl = `style/1/style/${STYLE_VERSION}`;
    styleParams = { map: MAP_STYLE };
    logger.info(`🗺️ Using default TomTom style endpoint`);
  }

  // Fetch dynamic copyright text based on map style
  const copyrightText = await fetchCopyrightCaption(useOrbis);
  logger.info(`📄 Copyright text: ${copyrightText}`);

  const response = await tomtomClient.get(styleUrl, {
    responseType: "json",
    params: styleParams
  });
  const style = response.data;

  // Validate style data
  if (!style || typeof style !== "object") {
    throw new Error("Invalid style data received from TomTom API");
  }

  // Initialize MapLibre Native map
  const map = new mbgl.Map({
    request: (req: any, callback: any) => {
      // Handle both absolute and relative URLs
      const url = req.url;

      // Debug the request URL
      logger.debug(`MapLibre requesting: ${url}`);

      // Handle URLs with special care to prevent double API keys
      const requestOptions: any = {
        responseType: "arraybuffer",
      };

      // Make direct axios request instead of tomtomClient to avoid adding key again
      axios
        .get(url, requestOptions)
        .then((r: any) => callback(null, { data: r.data }))
        .catch((e: any) => {
          logger.error(`MapLibre request failed for ${url}: ${e.message}`);
          callback(e);
        });
    },
    ratio: 1,
  });

  try {
    map.load(style);

    // Add polygons if present (Phase 2: Multi-polygon support with circles)
    // Polygons are rendered first so they appear underneath markers and routes
    if (polygons && polygons.length > 0) {
      const polygonFeatures = polygons
        .map((polygon: any, index: number) => {
          // Handle circle geometry
          if (polygon.type === "circle" || (polygon.center && polygon.radius)) {
            if (
              !polygon.center ||
              typeof polygon.center.lat !== "number" ||
              typeof polygon.center.lon !== "number"
            ) {
              logger.warn(`⚠️ Circle ${index} has invalid center coordinates.`);
              return null;
            }

            if (!polygon.radius || polygon.radius <= 0) {
              logger.warn(`⚠️ Circle ${index} has invalid radius.`);
              return null;
            }

            // Convert circle to polygon using our utilities
            const circlePoints = generateCirclePoints(
              polygon.center.lat,
              polygon.center.lon,
              polygon.radius,
              64 // steps
            );
            
            // Create polygon coordinates structure
            const polygonCoordinates = circlePoints.map(point => [point.lon, point.lat]);
            // Close the polygon by adding the first point again
            polygonCoordinates.push(polygonCoordinates[0]);
            
            const circleFeature = {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [polygonCoordinates]
              },
              properties: {}
            };

            return {
              type: "Feature",
              geometry: circleFeature.geometry,
              properties: {
                id: index,
                label: polygon.label || polygon.name || `Circle ${index + 1}`,
                fillColor: polygon.fillColor || "rgba(255, 193, 7, 0.3)",
                strokeColor: polygon.strokeColor || "#ffc107",
                strokeWidth: polygon.strokeWidth || 2,
                name: polygon.name || `Circle ${index + 1}`,
              },
            };
          }

          // Handle polygon coordinates (Phase 1 backward compatibility)
          if (polygon.coordinates && Array.isArray(polygon.coordinates)) {
            // Validate coordinates
            if (polygon.coordinates.length < 3) {
              logger.warn(
                `⚠️ Polygon ${index} has invalid coordinates. Minimum 3 points required.`
              );
              return null;
            }

            // Ensure polygon is closed (first and last points are the same)
            const coords = [...polygon.coordinates];
            const firstPoint = coords[0];
            const lastPoint = coords[coords.length - 1];
            if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
              coords.push([firstPoint[0], firstPoint[1]]); // Close the polygon
            }

            return {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [coords], // Wrap in array for exterior ring
              },
              properties: {
                id: index,
                label: polygon.label || polygon.name || `Area ${index + 1}`,
                fillColor: polygon.fillColor || "rgba(0, 123, 255, 0.3)",
                strokeColor: polygon.strokeColor || "#007bff",
                strokeWidth: polygon.strokeWidth || 2,
                name: polygon.name || `Polygon ${index + 1}`,
              },
            };
          }

          logger.warn(`⚠️ Polygon ${index} has neither valid coordinates nor circle definition.`);
          return null;
        })
        .filter(Boolean);

      if (polygonFeatures.length > 0) {
        // Add polygon data source
        map.addSource("polygons", {
          type: "geojson",
          data: { type: "FeatureCollection", features: polygonFeatures },
        });

        // Add fill layer (rendered first, underneath strokes)
        map.addLayer({
          id: "polygon-fill",
          type: "fill",
          source: "polygons",
          paint: {
            "fill-color": ["get", "fillColor"],
            "fill-opacity": 0.6,
          },
        });

        // Add stroke layer
        map.addLayer({
          id: "polygon-stroke",
          type: "line",
          source: "polygons",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["get", "strokeColor"],
            "line-width": ["get", "strokeWidth"],
            "line-opacity": 0.8,
          },
        });

        // Add labels if showLabels is enabled
        if (showLabels) {
          map.addLayer({
            id: "polygon-labels",
            type: "symbol",
            source: "polygons",
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["Noto-Bold"],
              "text-size": 11,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-padding": 10,
            },
            paint: {
              "text-color": "#333333",
              "text-halo-color": "#ffffff",
              "text-halo-width": 2,
              "text-halo-blur": 1,
            },
          });
        }

        logger.info(`✅ Added ${polygonFeatures.length} polygons to map`);
      }
    }

    // Add markers if present (adapted from original implementation)
    if (markers && markers.length > 0) {
      // Sort markers by priority for better label visibility
      // Higher priority markers are processed first and get label preference
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const sortedMarkers = [...markers].sort((a, b) => {
        const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2; // default to normal
        const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
        return aPriority - bPriority;
      });

      const markerFeatures = sortedMarkers
        .map((marker: any, index: number) => {
          const coords = extractCoordinates(marker, index, "marker");
          if (coords) {
            return {
              type: "Feature",
              geometry: { type: "Point", coordinates: [coords.lon, coords.lat] },
              properties: {
                id: index,
                label: marker.label || `Marker ${index + 1}`,
                color: marker.color || "#ff4444",
                priority: marker.priority || "normal",
              },
            };
          }
          return null;
        })
        .filter(Boolean);

      if (markerFeatures.length > 0) {
        map.addSource("markers", {
          type: "geojson",
          data: { type: "FeatureCollection", features: markerFeatures },
        });

        // Add enhanced marker styling (from original implementation)
        map.addLayer({
          id: "marker-shadow",
          type: "circle",
          source: "markers",
          paint: {
            "circle-radius": 20,
            "circle-color": "rgba(0, 0, 0, 0.25)",
            "circle-blur": 1,
            "circle-translate": [3, 3],
          },
        });

        map.addLayer({
          id: "marker-outer",
          type: "circle",
          source: "markers",
          paint: {
            "circle-radius": 18,
            "circle-color": "rgba(255, 255, 255, 0.9)",
            "circle-stroke-width": 2,
            "circle-stroke-color": "rgba(0, 0, 0, 0.3)",
          },
        });

        map.addLayer({
          id: "marker-layer",
          type: "circle",
          source: "markers",
          paint: {
            "circle-radius": 14,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 1,
          },
        });

        map.addLayer({
          id: "marker-inner",
          type: "circle",
          source: "markers",
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffffff",
            "circle-opacity": 1,
          },
        });

        // Add marker labels if enabled - enhanced with priority-based styling
        if (showLabels) {
          // Create separate label layers for each priority level for better browser compatibility
          const priorities = ["critical", "high", "normal", "low"];

          priorities.forEach((priority) => {
            map.addLayer({
              id: `marker-labels-${priority}`,
              type: "symbol",
              source: "markers",
              filter: ["==", ["get", "priority"], priority],
              layout: {
                "text-field": ["get", "label"],
                "text-font": ["Noto-Bold"],
                "text-offset": [0, 3.0],
                "text-anchor": "top",
                "text-size":
                  priority === "critical"
                    ? 15
                    : priority === "high"
                      ? 14
                      : priority === "low"
                        ? 12
                        : 13,
                "text-max-width": 12,
                "text-allow-overlap": priority === "critical",
                "text-padding": priority === "critical" ? 2 : priority === "high" ? 3 : 5,
                "text-line-height": 1.1,
              },
              paint: {
                "text-color":
                  priority === "critical" ? "#000000" : priority === "high" ? "#1a202c" : "#1a365d",
                "text-halo-color": "#ffffff",
                "text-halo-width": priority === "critical" ? 5 : priority === "high" ? 4.5 : 4,
                "text-halo-blur": 1,
              },
            });
          });
        }

        logger.info(`✅ Added ${markerFeatures.length} enhanced markers to map`);
      }
    }

    // Add routes if present (adapted from original implementation)
    if (routes && routes.length > 0) {
      const routeFeatures = routes
        .map((route: any, routeIndex: number) => {
          let routePoints: any[] = [];

          if (Array.isArray(route)) {
            routePoints = route;
          } else if (route.points && Array.isArray(route.points)) {
            routePoints = route.points;
          }

          if (routePoints.length > 1) {
            const validCoords = routePoints
              .map((point, pointIndex) =>
                extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
              )
              .filter((coord) => coord !== null)
              .map((coord) => [coord!.lon, coord!.lat]);

            if (validCoords.length > 1) {
              // Get route data for this specific route if available
              const currentRouteData = (routeData && routeData[routeIndex]) || {
                distance: "",
                travelTime: "",
                trafficDelay: "",
                trafficColor: "#007cbf",
                hasTrafficData: false,
                lengthInMeters: 0,
                travelTimeInSeconds: 0,
                trafficDelayInSeconds: 0,
                name: routeLabel || `Route ${routeIndex + 1}`,
              };

              // Create route summary label with route information
              let routeSummary = currentRouteData.name || routeLabel || `Route ${routeIndex + 1}`;
              if (currentRouteData.distance && currentRouteData.travelTime) {
                routeSummary += ` (${currentRouteData.distance}, ${currentRouteData.travelTime})`;
                if (currentRouteData.trafficDelayInSeconds > 0) {
                  routeSummary += ` +${currentRouteData.trafficDelay} delay`;
                }
              }

              return {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: validCoords,
                },
                properties: {
                  id: routeIndex,
                  label: routeSummary,
                  routeName: currentRouteData.name || routeLabel || `Route ${routeIndex + 1}`,
                  distance: currentRouteData.distance,
                  travelTime: currentRouteData.travelTime,
                  trafficDelay: currentRouteData.trafficDelay,
                  trafficColor: currentRouteData.trafficColor,
                  hasTrafficData: currentRouteData.hasTrafficData,
                  lengthInMeters: currentRouteData.lengthInMeters,
                  travelTimeInSeconds: currentRouteData.travelTimeInSeconds,
                  trafficDelayInSeconds: currentRouteData.trafficDelayInSeconds,
                },
              };
            }
          }
          return null;
        })
        .filter(Boolean);

      if (routeFeatures.length > 0) {
        map.addSource("routes", {
          type: "geojson",
          data: { type: "FeatureCollection", features: routeFeatures },
        });

        // Create separate features for route labels positioned at start and end points
        const routeLabelFeatures: any[] = [];

        routeFeatures.forEach((routeFeature: any, index: number) => {
          const coords = routeFeature.geometry.coordinates;
          if (coords && coords.length > 1) {
            // Start point label
            const startPoint = coords[0];
            routeLabelFeatures.push({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [startPoint[0], startPoint[1] + 0.0005], // Slight offset above
              },
              properties: {
                label: `Start: ${routeFeature.properties.routeName}`,
                summary: `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime}`,
                routeId: routeFeature.properties.id,
                type: "start",
              },
            });

            // End point label with route summary
            const endPoint = coords[coords.length - 1];
            routeLabelFeatures.push({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [endPoint[0], endPoint[1] - 0.0005], // Slight offset below
              },
              properties: {
                label: `End: ${routeFeature.properties.label}`,
                summary: routeFeature.properties.hasTrafficData
                  ? `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime} (+${routeFeature.properties.trafficDelay})`
                  : `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime}`,
                routeId: routeFeature.properties.id,
                type: "end",
              },
            });
          }
        });

        // Add route label source
        if (routeLabelFeatures.length > 0) {
          map.addSource("route-labels", {
            type: "geojson",
            data: { type: "FeatureCollection", features: routeLabelFeatures },
          });
        }

        // Add route outline for better visibility
        map.addLayer({
          id: "route-outline",
          type: "line",
          source: "routes",
          paint: {
            "line-width": 8,
            "line-color": "#ffffff",
            "line-opacity": 0.8,
          },
        });

        // Add main route layer with traffic-based coloring
        map.addLayer({
          id: "route-layer",
          type: "line",
          source: "routes",
          paint: {
            "line-width": 6,
            "line-color": ["get", "trafficColor"],
            "line-opacity": 1,
          },
        });

        // Add route summary labels if enabled - positioned to avoid marker label conflicts
        if (showLabels && routeLabelFeatures.length > 0) {
          map.addLayer({
            id: "route-labels",
            type: "symbol",
            source: "route-labels",
            layout: {
              "text-field": ["get", "summary"],
              "text-font": ["Noto-Bold"],
              "symbol-placement": "point",
              "text-anchor": "center",
              "text-size": 11,
              "text-max-width": 18,
              "text-allow-overlap": false,
              "text-padding": 15,
              "text-line-height": 1.0,
              "text-justify": "center",
            },
            paint: {
              "text-color": "#1976d2",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-halo-blur": 1,
            },
          });
        }

        logger.info(`✅ Added ${routeFeatures.length} enhanced routes to map`);
      }
    }

    // Render map to buffer (adapted from original Promise-based implementation)
    return new Promise((resolve, reject) => {
      map.render(
        { zoom, center, width, height },
        (err: Error | undefined, buffer: Uint8Array | undefined) => {
          if (map) map.release();
          if (err) {
            reject(new Error(`Map rendering failed: ${err.message}`));
          } else if (!buffer) {
            reject(new Error("Map rendering failed: No buffer returned"));
          } else {
            try {
              // Convert raw buffer to PNG using canvas (from original implementation)
              const canvas = createCanvas(width, height);
              const ctx = canvas.getContext("2d");

              // Create ImageData from the raw buffer
              const imageData = ctx.createImageData(width, height);

              // MapLibre returns RGBA data, copy it to ImageData
              for (let i = 0; i < buffer.length; i++) {
                imageData.data[i] = buffer[i];
              }

              // Put the image data on canvas
              ctx.putImageData(imageData, 0, 0);

              // Draw TomTom copyright text with dynamic background sizing
              const copyrightDisplayText = copyrightText || "© TomTom";
              ctx.font = "bold 14px Arial";
              ctx.textAlign = "right";
              ctx.textBaseline = "bottom";
              
              // Measure text dimensions
              const textMetrics = ctx.measureText(copyrightDisplayText);
              const textWidth = Math.ceil(textMetrics.width);
              const textHeight = 16; // Approximate height for 14px font
              const padding = 6; // Padding around text
              
              // Calculate background rectangle dimensions and position
              // Position: right: 100px, bottom: 8px (CSS-like positioning)
              const bgWidth = textWidth + (padding * 2);
              const bgHeight = textHeight + (padding * 2);
              const bgX = width - bgWidth - 100; // 100px margin from right edge
              const bgY = height - bgHeight - 8; // 8px margin from bottom edge
              
              // Draw background rectangle
              ctx.fillStyle = "rgba(255,255,255,0.5)";
              ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
              
              // Draw text
              ctx.fillStyle = "#000";
              ctx.fillText(copyrightDisplayText, width - padding - 100, height - padding - 8);
              
              const pngBuffer = canvas.toBuffer("image/png");

              resolve(pngBuffer);
            } catch (conversionError: any) {
              reject(new Error(`PNG conversion failed: ${conversionError.message}`));
            }
          }
        }
      );
    });
  } catch (error: any) {
    if (map) map.release();
    throw error;
  }
}

/**
 * Renders a dynamic map with advanced features
 * @param options Dynamic map rendering options
 * @returns Promise resolving to the rendered map data
 */
export async function renderDynamicMap(options: DynamicMapOptions): Promise<DynamicMapResponse> {
  // Validate TomTom API key
  validateApiKey();

  logger.info("🗺️ Processing dynamic map request");

  try {
    // Check if all required dependencies are available
    if (!mbgl || !createCanvas) {
      throw new Error("Dynamic map dependencies not available. Install @maplibre/maplibre-gl-native and canvas to enable this feature, or use Docker for a pre-configured environment.");
    }

    // Apply default options
    const finalOptions = { ...DEFAULT_DYNAMIC_MAP_OPTIONS, ...options };

    // Prepare markers array (adapted from original route handling logic)
    let markers: any[] = [];
    if (finalOptions.markers) {
      markers = [...finalOptions.markers];
    }

    // Validate origin/destination pairing
    const hasOrigin = !!finalOptions.origin;
    const hasDestination = !!finalOptions.destination;

    if (hasOrigin && !hasDestination) {
      throw new Error(
        "Origin provided without destination. Both origin and destination are required for route planning."
      );
    }

    if (!hasOrigin && hasDestination) {
      throw new Error(
        "Destination provided without origin. Both origin and destination are required for route planning."
      );
    }

    // Determine if we're in route planning mode
    const isRoutePlanningMode = hasOrigin && hasDestination;

    // Prepare polygons array
    let polygons: any[] = [];
    if (finalOptions.polygons) {
      polygons = [...finalOptions.polygons];
    }

    // Validate that we have some content to display
    const hasMarkers = markers && markers.length > 0;
    const hasPolygons = polygons && polygons.length > 0;
    const hasDirectRoutes = (finalOptions as any).routes && (finalOptions as any).routes.length > 0;
    const hasBbox =
      finalOptions.bbox && Array.isArray(finalOptions.bbox) && finalOptions.bbox.length === 4;

    if (!isRoutePlanningMode && !hasMarkers && !hasPolygons && !hasDirectRoutes && !hasBbox) {
      throw new Error(
        "Map requires content to display. Please provide at least one of: markers, polygons, routes, origin+destination (for route planning), or bbox (for area bounds)."
      );
    }

    // Handle route planning mode (auto-detect based on origin/destination)
    if (isRoutePlanningMode) {
      const originCoords = extractCoordinates(finalOptions.origin, 0, "origin");
      const destCoords = extractCoordinates(finalOptions.destination, 0, "destination");

      if (!originCoords || !destCoords) {
        throw new Error("Invalid origin or destination coordinates");
      }

      // Add route planning markers to existing markers (preserve user markers)
      const originLabel = (finalOptions.origin as any)?.label || "Start";
      const destLabel = (finalOptions.destination as any)?.label || "End";

      markers.push({
        lat: originCoords.lat,
        lon: originCoords.lon,
        label: originLabel,
        color: "#22c55e",
      });

      // Add waypoints if provided with custom labels
      if (finalOptions.waypoints && finalOptions.waypoints.length > 0) {
        finalOptions.waypoints.forEach((wp, i) => {
          const wpCoords = extractCoordinates(wp, i, "waypoint");
          if (wpCoords) {
            const waypointLabel = (wp as any)?.label || `Waypoint ${i + 1}`;
            markers.push({
              lat: wpCoords.lat,
              lon: wpCoords.lon,
              label: waypointLabel,
              color: "#f97316",
            });
          }
        });
      }

      markers.push({
        lat: destCoords.lat,
        lon: destCoords.lon,
        label: destLabel,
        color: "#ef4444",
      });
    }

    // Calculate routes intelligently using TomTom routing service
    let routes: Array<Array<{ lat: number; lon: number }>> = [];
    const routeData: Array<{
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
      distance: string;
      travelTime: string;
      trafficDelay: string;
      trafficColor: string;
      hasTrafficData: boolean;
      name: string;
    }> = [];

    // Handle direct routes (when routes are provided directly, not in route planning mode)
    if (
      (finalOptions as any).routes &&
      (finalOptions as any).routes.length > 0 &&
      !isRoutePlanningMode
    ) {
      routes = (finalOptions as any).routes
        .map((route: any, routeIndex: number) => {
          let routePoints: any[] = [];

          if (Array.isArray(route)) {
            routePoints = route;
          } else if (route.points && Array.isArray(route.points)) {
            routePoints = route.points;
          }

          if (routePoints.length > 1) {
            const validCoords = routePoints
              .map((point, pointIndex) =>
                extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
              )
              .filter((coord) => coord !== null)
              .map((coord) => [coord!.lat, coord!.lon]);

            if (validCoords.length > 1) {
              // Add start/end markers for routes if no specific markers provided for these points
              const startCoord = validCoords[0];
              const endCoord = validCoords[validCoords.length - 1];

              // Check if we already have markers at start/end points (within reasonable distance)
              const hasStartMarker = markers.some(
                (m) =>
                  Math.abs(m.lat - startCoord[0]) < 0.001 && Math.abs(m.lon - startCoord[1]) < 0.001
              );
              const hasEndMarker = markers.some(
                (m) =>
                  Math.abs(m.lat - endCoord[0]) < 0.001 && Math.abs(m.lon - endCoord[1]) < 0.001
              );

              // Add automatic start/end markers if not present
              if (!hasStartMarker) {
                markers.push({
                  lat: startCoord[0],
                  lon: startCoord[1],
                  label: route.name ? `${route.name} Start` : `Route ${routeIndex + 1} Start`,
                  color: "#22c55e",
                });
              }

              if (!hasEndMarker) {
                markers.push({
                  lat: endCoord[0],
                  lon: endCoord[1],
                  label: route.name ? `${route.name} End` : `Route ${routeIndex + 1} End`,
                  color: "#ef4444",
                });
              }

              return validCoords.map((coord) => ({ lat: coord[0], lon: coord[1] }));
            }
          }
          return [];
        })
        .filter((route: any) => route.length > 0);

      logger.info(`✅ Processed ${routes.length} direct routes with automatic start/end markers`);
    }

    // Calculate routes using TomTom routing service (route planning mode)
    else if (finalOptions.origin && finalOptions.destination) {
      try {
        const routeOptions: RouteOptions = {
          routeType: finalOptions.routeType || "fastest",
          travelMode: finalOptions.travelMode || "car",
          avoid: finalOptions.avoid,
          traffic: finalOptions.traffic || false,
          instructionsType: "text",
          sectionType: [],
          computeTravelTimeFor: "all",
        };

        let routeResult;
        if (finalOptions.waypoints && finalOptions.waypoints.length > 0) {
          // Use multi-waypoint routing
          const waypoints = [
            finalOptions.origin,
            ...finalOptions.waypoints,
            finalOptions.destination,
          ];
          routeResult = await getMultiWaypointRoute(waypoints, routeOptions);
        } else {
          // Use simple routing
          routeResult = await getRoute(finalOptions.origin, finalOptions.destination, routeOptions);
        }

        if (routeResult && routeResult.routes && routeResult.routes.length > 0) {
          routes = routeResult.routes.map((route, index) => {
            const coordinates: Array<{ lat: number; lon: number }> = [];
            route.legs?.forEach((leg) => {
              leg.points?.forEach((point) => {
                coordinates.push({
                  lat: point.latitude,
                  lon: point.longitude,
                });
              });
            });

            // Extract route summary data
            const lengthInMeters = route.summary?.lengthInMeters || 0;
            const travelTimeInSeconds = route.summary?.travelTimeInSeconds || 0;
            const trafficDelayInSeconds = route.summary?.trafficDelayInSeconds || 0;

            // Format the information
            const distance = formatDistance(lengthInMeters);
            const travelTime = formatTime(travelTimeInSeconds);
            const trafficDelay = formatTime(trafficDelayInSeconds);
            const trafficColor = getTrafficColor(travelTimeInSeconds, trafficDelayInSeconds);

            // Store route metadata
            routeData.push({
              lengthInMeters,
              travelTimeInSeconds,
              trafficDelayInSeconds,
              distance,
              travelTime,
              trafficDelay,
              trafficColor,
              hasTrafficData: trafficDelayInSeconds > 0,
              name: finalOptions.routeLabel || `Route ${index + 1}`,
            });

            return coordinates;
          });

          logger.info(
            `Calculated ${routes.length} routes with total ${routes.reduce((sum, route) => sum + route.length, 0)} coordinates`
          );
        }
      } catch (routeError) {
        logger.warn(
          `Failed to calculate route: ${routeError}. Proceeding without route visualization.`
        );
      }
    }

    // Render the map using the adapted MapLibre implementation
    const buffer = await renderMapWithMapLibre({
      bbox: finalOptions.bbox,
      width: finalOptions.width,
      height: finalOptions.height,
      markers,
      routes,
      polygons,
      routeData,
      showLabels: finalOptions.showLabels || false,
      routeLabel: finalOptions.routeLabel,
      useOrbis: finalOptions.use_orbis || false,
    });

    // Convert buffer to base64
    const base64 = buffer.toString("base64");

    const responseData: DynamicMapResponse = {
      base64,
      contentType: "image/png",
      width: finalOptions.width || DEFAULT_DYNAMIC_MAP_OPTIONS.width,
      height: finalOptions.height || DEFAULT_DYNAMIC_MAP_OPTIONS.height,
    };

    logger.info(`✅ Dynamic map rendered successfully: ${(buffer.length / 1024).toFixed(2)} KB`);

    return responseData;
  } catch (error: any) {
    logger.error(`❌ Dynamic map generation failed: ${error.message}`);

    // Since we're using static imports, dependency errors will be caught at module load time
    // This provides cleaner error handling for actual runtime issues
    throw error;
  }
}
