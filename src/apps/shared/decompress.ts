/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import pako from "pako";

/** Decompress gzip+base64 encoded data */
function decompressData(base64Data: string): any {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return JSON.parse(pako.inflate(bytes, { to: "string" }));
}

/** Extract full data from MCP tool response, with fallbacks for backward compatibility */
export function extractFullData(agentResponse: any): any {
  if (agentResponse._meta?._compressed) {
    try {
      return decompressData(agentResponse._meta._compressed);
    } catch (e) {
      console.error("Failed to decompress:", e);
    }
  }
  return agentResponse._meta?._fullData || agentResponse;
}
