export interface Preset {
  key: string;
  label: string;
  input: Record<string, unknown>;
}

const AMSTERDAM: [number, number] = [4.8897, 52.374];

const EUROPEAN_CAPITALS = [
  { lat: 52.374, lon: 4.8897, label: "Amsterdam" },
  { lat: 52.52, lon: 13.405, label: "Berlin" },
  { lat: 48.8566, lon: 2.3522, label: "Paris" },
  { lat: 51.5074, lon: -0.1278, label: "London" },
  { lat: 50.8503, lon: 4.3517, label: "Brussels" },
  { lat: 40.4168, lon: -3.7038, label: "Madrid" },
  { lat: 41.9028, lon: 12.4964, label: "Rome" },
  { lat: 48.2082, lon: 16.3738, label: "Vienna" },
  { lat: 50.0755, lon: 14.4378, label: "Prague" },
  { lat: 55.6761, lon: 12.5683, label: "Copenhagen" },
  { lat: 59.3293, lon: 18.0686, label: "Stockholm" },
  { lat: 38.7223, lon: -9.1393, label: "Lisbon" },
];

export const UX_PRESETS: Record<string, Preset[]> = {
  "tomtom-routing": [
    {
      key: "long-route",
      label: "Long route Amsterdam → Rome",
      input: { locations: [AMSTERDAM, [12.4964, 41.9028]], routeType: "fast", traffic: "live", show_ui: true, response_detail: "compact" },
    },
    {
      key: "city-route",
      label: "Short city route",
      input: { locations: [AMSTERDAM, [4.8852, 52.36]], routeType: "fast", traffic: "live", show_ui: true, response_detail: "compact" },
    },
    {
      key: "multi-stop",
      label: "Multi-stop trip",
      input: { locations: [AMSTERDAM, [5.1214, 52.0907], [4.4777, 51.9244], [4.3007, 52.0705]], routeType: "fast", show_ui: true, response_detail: "compact" },
    },
    {
      key: "alternatives",
      label: "With 3 alternatives",
      input: { locations: [AMSTERDAM, [6.7735, 51.2277]], maxAlternatives: 3, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-traffic": [
    {
      key: "london",
      label: "Busy: central London",
      input: { bbox: [-0.2, 51.47, -0.05, 51.54], language: "en-US", show_ui: true, response_detail: "compact" },
    },
    {
      key: "paris",
      label: "Busy: Paris ring",
      input: { bbox: [2.25, 48.82, 2.42, 48.9], language: "en-US", show_ui: true, response_detail: "compact" },
    },
    {
      key: "quiet",
      label: "Quiet: rural Friesland",
      input: { bbox: [5.6, 53.0, 5.7, 53.06], language: "en-US", show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-dynamic-map": [
    {
      key: "many-markers",
      label: "12 capitals",
      input: { markers: EUROPEAN_CAPITALS, showLabels: true, show_ui: true },
    },
    {
      key: "route-plans",
      label: "Two road routes",
      input: {
        routePlans: [
          { origin: { lat: 52.3676, lon: 4.9041, label: "Amsterdam Central" }, destination: { lat: 52.0907, lon: 5.1214, label: "Utrecht" }, label: "Fast", routeType: "fast" },
          { origin: { lat: 52.3676, lon: 4.9041, label: "Amsterdam Central" }, destination: { lat: 52.0907, lon: 5.1214, label: "Utrecht" }, label: "Short", routeType: "short" },
        ],
        show_ui: true,
      },
    },
    {
      key: "areas",
      label: "Areas and markers",
      input: {
        markers: [{ lat: 52.3676, lon: 4.9041, label: "Amsterdam Central" }, { lat: 52.36, lon: 4.8852, label: "Rijksmuseum" }],
        polygons: [
          { type: "circle", center: { lat: 52.3676, lon: 4.9041 }, radius: 800, label: "800 m walk", fillColor: "#007bff" },
          { type: "polygon", coordinates: [[4.88, 52.355], [4.895, 52.355], [4.895, 52.365], [4.88, 52.365], [4.88, 52.355]], label: "Museum quarter", fillColor: "#e4572e" },
        ],
        showLabels: true,
        show_ui: true,
      },
    },
  ],
  "tomtom-fuzzy-search": [
    {
      key: "many",
      label: "Many results (30)",
      input: { query: "restaurants in Amsterdam", position: AMSTERDAM, limit: 30, show_ui: true, response_detail: "compact" },
    },
    {
      key: "none",
      label: "No results",
      input: { query: "zzqxwv nonexistent place", position: AMSTERDAM, limit: 5, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-poi-search": [
    {
      key: "many",
      label: "Many results (30)",
      input: { query: "coffee shop", position: AMSTERDAM, limit: 30, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-nearby": [
    {
      key: "wide",
      label: "Wide radius (30 results)",
      input: { position: AMSTERDAM, poiCategories: ["RESTAURANT"], radius: 5000, limit: 30, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-geocode": [
    {
      key: "ambiguous",
      label: "Ambiguous: Springfield",
      input: { query: "Springfield", limit: 10, language: "en-US", show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-ev-search": [
    {
      key: "many",
      label: "Many chargers (30)",
      input: { position: [4.9041, 52.3676], radius: 10000, limit: 30, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-area-search": [
    {
      key: "many",
      label: "Many results (30)",
      input: { query: "restaurant", center: [4.9041, 52.3676], radius: 3000, limit: 30, show_ui: true, response_detail: "compact" },
    },
  ],
  "tomtom-search-along-route": [
    {
      key: "long",
      label: "Long route Amsterdam → Paris",
      input: { origin: [4.9041, 52.3676], destination: [2.3522, 48.8566], query: "gas station", limit: 10, show_ui: true, response_detail: "compact" },
    },
  ],
};
