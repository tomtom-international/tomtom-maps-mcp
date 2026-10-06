/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { DelayMagnitude } from "@tomtom-org/maps-sdk/core";
import type { TrafficIncidentsModuleFeature } from "@tomtom-org/maps-sdk/map";
import { escapeHtml } from "./poi-popup";

/** The incident properties TrafficIncidentsModule gives its events and getRenderedFeatures(). */
export type IncidentProperties = TrafficIncidentsModuleFeature["properties"];

const ICON_WARNING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_LOCATION = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ICON_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

const MAGNITUDE_STYLES: Record<DelayMagnitude, { label: string; color: string }> = {
  unknown: { label: "Unknown", color: "#6b7280" },
  minor: { label: "Minor", color: "#ca8a04" },
  moderate: { label: "Moderate", color: "#ea580c" },
  major: { label: "Major", color: "#dc2626" },
  indefinite: { label: "Indefinite", color: "#991b1b" },
};

function row(icon: string, content: string, color?: string): string {
  const style = color ? ` style="color:${color}"` : "";
  return `<div class="incident-popup-row"><span class="incident-popup-icon"${style}>${icon}</span>${content}</div>`;
}

/** "road-closed" → "Road closed" */
function categoryLabel(category: string): string {
  const words = category.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function buildIncidentPopupHtml(props: IncidentProperties): string {
  const category = props.category ? categoryLabel(props.category) : "";
  const magnitude = MAGNITUDE_STYLES[props.magnitudeOfDelay];
  const title =
    props.description || category || (magnitude ? `${magnitude.label} congestion` : "Traffic");

  let html = `<div class="incident-popup"><div class="incident-popup-title">${escapeHtml(title)}</div>`;

  if (props.description && category) {
    html += row(ICON_WARNING, `<span>${escapeHtml(category)}</span>`);
  }
  if (magnitude) {
    html += row(
      ICON_WARNING,
      `<span style="color:${magnitude.color};font-weight:600">${magnitude.label}</span>`,
      magnitude.color
    );
  }

  const road = [props.roadCategory, props.roadSubcategory].filter(Boolean).join(" · ");
  if (road) html += row(ICON_LOCATION, `<span>${escapeHtml(road)}</span>`);

  if (props.startTime) {
    const end = props.endTime ? ` → ${formatDate(props.endTime)}` : "";
    html += row(ICON_CLOCK, `<span>${escapeHtml(formatDate(props.startTime) + end)}</span>`);
  }

  const delay = props.delayInSeconds ?? 0;
  if (delay > 0) {
    const minutes = Math.round(delay / 60);
    html += row(
      ICON_CLOCK,
      `<span>${minutes > 0 ? `${minutes} min delay` : `${delay}s delay`}</span>`
    );
  }

  const reports = props.numberOfReports ?? 0;
  if (reports > 0) {
    html += row(ICON_LOCATION, `<span>${reports} report${reports > 1 ? "s" : ""}</span>`);
  }

  return `${html}</div>`;
}
