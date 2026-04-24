// Renders ${VAR} placeholders in config/test files using values from .env.
// Output goes to .rendered/ so the source files remain template-pure.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const envPath = join(root, '.env');

if (!existsSync(envPath)) {
  console.error('Missing .env — copy .env.example to .env and fill in values.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
    })
);

// Pull the current build's main bundle filename from asset-manifest.json so
// templates can reference it as ${BUNDLE_MAIN} without manual updates per build.
const manifestPath = join(root, 'dist', 'acme-bridge-poc', 'browser', 'asset-manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.main) env.BUNDLE_MAIN = manifest.main;
}

const templates = [
  'bucket-policy.json',
  'cf-distro-config.json',
  'cors-config.json',
  'index.html',
];

const outDir = join(root, '.rendered');
mkdirSync(outDir, { recursive: true });

for (const t of templates) {
  const src = join(root, t);
  if (!existsSync(src)) continue;

  const raw = readFileSync(src, 'utf8');

  // First pass: "${VAR[]}" -> JSON array parsed from a comma-separated env value.
  // The surrounding quotes are consumed so the result is a bare JSON array literal.
  const withArrays = raw.replace(/"\$\{(\w+)\[\]\}"/g, (_, k) => {
    if (!(k in env)) throw new Error(`Missing env var ${k} (required by ${t})`);
    const items = env[k].split(',').map(s => s.trim()).filter(Boolean);
    return JSON.stringify(items);
  });

  // Second pass: scalar ${VAR} -> string value.
  const rendered = withArrays.replace(/\$\{(\w+)\}/g, (_, k) => {
    if (!(k in env)) throw new Error(`Missing env var ${k} (required by ${t})`);
    return env[k];
  });

  writeFileSync(join(outDir, t), rendered);
  console.log(`rendered: ${t} -> .rendered/${t}`);
}
