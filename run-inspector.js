#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Utility script to run the MCP Inspector with environment variables from .env file
 * This script reads TOMTOM_API_KEY and TOMTOM_MOVE_PORTAL_KEY from .env and passes them
 * to the MCP inspector command.
 */

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    
    if (!fs.existsSync(envPath)) {
        console.error('Error: .env file not found');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};

    // Parse .env file
    envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0) {
                let value = valueParts.join('=');
                // Remove surrounding quotes if present
                value = value.replace(/^["']|["']$/g, '');
                envVars[key] = value;
            }
        }
    });

    return envVars;
}

function runInspector() {
    try {
        const envVars = loadEnvFile();
        
        const tomtomApiKey = envVars.TOMTOM_API_KEY;

        if (!tomtomApiKey) {
            console.error('Error: TOMTOM_API_KEY not found in .env file');
            process.exit(1);
        }

        console.log('Starting MCP Inspector with TomTom API keys...');
        console.log('API Key:', tomtomApiKey.substring(0, 8) + '...');

        const command = `npx @modelcontextprotocol/inspector node bin/tomtom-mcp.js -e TOMTOM_API_KEY=${tomtomApiKey}`;
        
        console.log('\nRunning command:');
        console.log(command.replace(tomtomApiKey, tomtomApiKey.substring(0, 8) + '...'));
        console.log('');

        // Execute the command
        execSync(command, { 
            stdio: 'inherit',
            cwd: __dirname 
        });

    } catch (error) {
        console.error('Error running MCP Inspector:', error.message);
        process.exit(1);
    }
}


runInspector();

export { loadEnvFile, runInspector };
