/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * TomTom API key injected at build time from TOMTOM_API_KEY environment variable.
 * Vite replaces import.meta.env.VITE_TOMTOM_API_KEY during the build process.
 */
export const API_KEY: string = import.meta.env.VITE_TOMTOM_API_KEY || "";

if (!API_KEY) {
  console.error("TOMTOM_API_KEY not set. Please set the environment variable before building.");
}
