// =============================================================================
// prepare-cdn.mjs — Post-build: generate asset-manifest.json
// =============================================================================
// Angular's production build outputs content-hashed filenames (e.g. main-3a7f2c.js).
// The SFCC template needs to know the exact filenames to construct <script> tags.
// This script scans the build output and writes a manifest the SFCC controller
// can fetch (or that can be inlined at deploy time).
// =============================================================================

import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist', 'acme-bridge-poc', 'browser');

const files = readdirSync(distDir);

const manifest = {
  main: files.find(f => f.startsWith('main') && f.endsWith('.js')) || null,
  polyfills: files.find(f => f.startsWith('polyfills') && f.endsWith('.js')) || null,
  styles: files.find(f => f.startsWith('styles') && f.endsWith('.css')) || null,
  version: process.env.npm_package_version || '0.0.1',
  buildTime: new Date().toISOString(),
};

const outPath = join(distDir, 'asset-manifest.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log('asset-manifest.json written:');
console.log(JSON.stringify(manifest, null, 2));
