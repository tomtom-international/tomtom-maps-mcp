import { searchPlaces, geocodeAddress, reverseGeocode } from "../src/services/search/searchService.js";
import { getRoute } from "../src/services/routing/routingService.js";
import { getTrafficIncidents } from "../src/services/traffic/trafficService.js";

const DELAY_MS = 500;

const calls = [
  { name: "Search Places", fn: () => searchPlaces("Amsterdam") },
  { name: "Geocode", fn: () => geocodeAddress("London") },
  { name: "Reverse Geocode", fn: () => reverseGeocode(52.3676, 4.9041) },
  { name: "Search Places", fn: () => searchPlaces("Berlin restaurant") },
  { name: "Route", fn: () => getRoute({ lat: 52.3676, lon: 4.9041 }, { lat: 48.8566, lon: 2.3522 }) },
  { name: "Traffic", fn: () => getTrafficIncidents("4.85,52.34,4.95,52.39") },
  { name: "Geocode", fn: () => geocodeAddress("Paris") },
  { name: "Search Places", fn: () => searchPlaces("Tokyo hotel") },
  { name: "Reverse Geocode", fn: () => reverseGeocode(48.8566, 2.3522) },
  { name: "Route", fn: () => getRoute({ lat: 48.8566, lon: 2.3522 }, { lat: 52.5200, lon: 13.4050 }) },
];

async function main() {
  if (!process.env.TOMTOM_API_KEY) {
    console.error("TOMTOM_API_KEY env var is required");
    process.exit(1);
  }

  console.log(`Sending ${calls.length} requests through MCP services...\n`);

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    try {
      await call.fn();
      console.log(`[${i + 1}/${calls.length}] ${call.name} — OK`);
    } catch (err: any) {
      console.error(`[${i + 1}/${calls.length}] ${call.name} — ${err.response?.status ?? err.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log("\nDone. Check data explorer for TomTom-Upstream-Metadata header.");
}

main();
