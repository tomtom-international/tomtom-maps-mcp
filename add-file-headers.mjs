/*
 * UTILITY SCRIPT - NOT A LICENSE DOCUMENT
 * This script adds the standard license header to source code files in the project.
 * It is not a license document itself, but a tool to apply license notices to source files.
 */

import fs from 'fs';
import path from 'path';

// License header template
const licenseHeader = `/*
 * Copyright (C) 2025 TomTom Navigation B.V.
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

`;

// Extensions to process
const extensions = ['.ts', '.js', '.tsx', '.jsx'];

// Find all source files
function findSourceFiles(dir) {
  let results = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !fullPath.includes('node_modules') && !fullPath.includes('dist')) {
      results = results.concat(findSourceFiles(fullPath));
    } else if (stat.isFile() && extensions.includes(path.extname(fullPath))) {
      results.push(fullPath);
    }
  }
  
  return results;
}

// Add license header (and preserve shebang) to file if it doesn't already have one
function addLicenseHeader(filePath) {
  console.log(`Processing: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if file already has a license header
  if (content.includes('Copyright (C)') && content.includes('TomTom')) {
    console.log(`  Already has license header`);
    return;
  }

  // Preserve shebang if present
  let shebang = '';
  const lines = content.split(/\r?\n/);
  if (lines[0].startsWith('#!')) {
    shebang = lines.shift() + '\n';
  }
  const body = lines.join('\n');

  // Write back with shebang, license header, then original body
  const newContent = shebang + licenseHeader + body;
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log(`  Added license header`);
}

// Main function
function main() {
  console.log('Adding license headers to source files...');
  
  const sourceFiles = findSourceFiles(path.resolve('.'));
  console.log(`Found ${sourceFiles.length} source files to process`);
  
  for (const file of sourceFiles) {
    addLicenseHeader(file);
  }
  
  console.log('License headers added successfully!');
}

// Run the script
main();