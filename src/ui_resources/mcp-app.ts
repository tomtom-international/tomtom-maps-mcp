import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, PlacesModule } from '@tomtom-org/maps-sdk/map';
import { API_KEY } from './config';
import './style.css';

// Initialize TomTom Maps SDK
TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

// Create map instance
const map = new TomTomMap({
    mapLibre: {
        container: 'sdk-map',
        center: [4.8156, 52.4414],
        zoom: 8,
    },
});

// Initialize Places Module
let placesModule: PlacesModule | null = null;

(async () => {
    placesModule = await PlacesModule.get(map, {
        text: {
            title: (place: any) => place.properties.poi?.name || place.properties.address?.freeformAddress || 'Unknown'
        },
        theme: 'pin'
    });

    // Handle clicks on POI markers
    placesModule.events.on('click', (feature: any) => {
        const props = feature.properties;
        const poi = props.poi || {};
        const address = props.address || {};

        console.log('POI clicked:', {
            name: poi.name,
            address: address.freeformAddress,
            phone: poi.phone,
            url: poi.url,
            categories: poi.categories
        });
    });
})();

// Initialize MCP App
const app = new App({
    name: 'TomTom POI Search',
    version: '1.0.0',
});

// Display POI results using PlacesModule
async function displayPOIs(data: any) {
    if (!placesModule) return;

    const results = data.results || [];
    if (results.length === 0) {
        await placesModule.clear();
        return;
    }

    // Convert POI results to Places format for SDK
    const places = results.map((poi: any) => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [poi.position.lon, poi.position.lat]
        },
        properties: {
            ...poi,
            id: poi.id,
            address: poi.address,
            poi: poi.poi,
            position: poi.position
        }
    }));

    // Display places on map
    await placesModule.show(places);

    // Calculate and fit bounds
    const bounds = results.map((poi: any) => [poi.position.lon, poi.position.lat]);
    if (bounds.length === 1) {
        map.mapLibreMap.setCenter(bounds[0]);
        map.mapLibreMap.setZoom(14);
    } else if (bounds.length > 1) {
        const bbox = bounds.reduce((acc: any, [lng, lat]: any) => ({
            minLng: Math.min(acc.minLng, lng),
            maxLng: Math.max(acc.maxLng, lng),
            minLat: Math.min(acc.minLat, lat),
            maxLat: Math.max(acc.maxLat, lat),
        }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

        map.mapLibreMap.fitBounds([
            [bbox.minLng, bbox.minLat],
            [bbox.maxLng, bbox.maxLat]
        ], { padding: 50 });
    }
}

// Register handlers BEFORE connect()
app.ontoolinput = (params) => {
    console.log('Tool input:', params);
};

app.ontoolresult = (result) => {
    if (result.isError) {
        console.error('Tool error:', result);
        return;
    }

    try {
        const content = result.content[0];
        if (content.type === 'text') {
            const apiResponse = JSON.parse(content.text);
            // Raw API response has { summary, results }
            displayPOIs(apiResponse);
        }
    } catch (error) {
        console.error('Failed to parse tool result:', error);
    }
};

app.onhostcontextchanged = (ctx) => {
};

app.onteardown = async () => {
    if (placesModule) {
        await placesModule.clear();
    }
    return {};
};

// Connect the app
app.connect();
