import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import './style.css';
import { API_KEY } from './config';

// (Set your own API key when working in your own environment)
TomTomConfig.instance.put({ apiKey: API_KEY, language: 'en-GB' });

new TomTomMap({
    mapLibre: {
        container: 'sdk-map',
        center: [4.8156, 52.4414],
        zoom: 8,
    },
});
