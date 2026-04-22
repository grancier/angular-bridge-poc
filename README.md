# Bridge PoC — Angular Elements + Shadow DOM + CustomEvent

Minimal proof-of-concept that validates the Angular Elements architecture for embedding Angular inside SFCC's SFRA storefront. One button, one product, full event lifecycle — no App dependencies.

## What This Proves

1. **Shadow DOM isolation** — Angular styles don't leak into SFRA; SFRA styles don't leak into Angular.
2. **Zoneless Angular** — No Zone.js. SFRA's jQuery event loop is unaffected.
3. **CustomEvent bridge** — `ds:add-to-cart` escapes the shadow root via `composed: true`, host listener translates it into an SFCC cart operation, `ds:cart-response` returns to Angular.
4. **jQuery storefront sync** — `product:afterAddToCart` and `count:update` triggers fire after cart mutation, proving minicart/badge integration works.
5. **CDN-hosted bundles** — Angular loads from an external CDN, not cartridge static assets. Zero build coupling.
6. **Independent deployment** — Angular deploys to S3/CloudFront. SFCC deploys its cartridge. The only sync point is a version string in Site Preferences.

## Project Structure

```
poc/
├── angular/                    # Angular Elements application
│   ├── main.ts                 # Single-file app: component + bridge service + bootstrap
│   ├── angular.json            # CLI config: ESM output, hashed filenames, no index.html
│   ├── tsconfig.json           # TS config: ES2022, strict, bundler resolution
│   ├── package.json            # Dependencies, build scripts, deploy scripts
│   └── scripts/
│       └── prepare-cdn.mjs     # Post-build: generates asset-manifest.json
│
└── sfcc/                       # SFCC cartridge template
    └── bridgepoc.isml          # Shell page: custom element + bridge listener
```

## Prerequisites

- Node.js >= 20.x
- Angular CLI 21.x (`npm install -g @angular/cli@21`)
- AWS CLI configured with credentials for the target S3 bucket
- SFCC sandbox with cartridge upload access

## Build

```bash
cd poc/angular

# Install dependencies
npm install

# Development build (source maps, no optimization)
ng build --configuration=development

# Production build (optimized, hashed filenames, ESM output)
npm run build:cdn
```

The production build outputs to `dist/acme-bridge-poc/browser/`:

```
dist/acme-bridge-poc/browser/
├── main-[hash].js              # Angular application bundle
├── polyfills-[hash].js         # Polyfills (minimal without Zone.js)
├── chunk-[hash].js             # Lazy chunks (if any)
└── asset-manifest.json         # Maps logical names to hashed filenames
```

## Local Development (Standalone Mode)

```bash
cd poc/angular
ng serve
```

Open `http://localhost:4200`. The `SfccBridgeService` detects it's not embedded inside SFCC and returns mock responses. The button works, the event log populates, and the component renders inside its shadow root — all without SFCC running.

To verify Shadow DOM isolation, inspect the element in DevTools: you should see `#shadow-root (open)` under `<acme-bridge-poc>`. Styles defined inside the component are not visible in the parent document's stylesheet list.

## Deploy to AWS (S3 + CloudFront)

### One-time setup

1. **S3 bucket** — Create a bucket (e.g., `acme-bridge-poc-cdn`) with public access blocked. CloudFront will serve as the public edge.

2. **CloudFront distribution** — Create a distribution with:
   - Origin: the S3 bucket (use OAC, not OAI)
   - Default cache behavior: `Cache-Control` header from origin
   - CORS: allow `https://www.acme.com`, `https://clsb01.acme.com`, `https://clsb02.acme.com`
   - Custom domain (optional): `cdn.acme.com` with wildcard cert

3. **Environment variables** for deploy scripts:
   ```bash
   export CDN_BUCKET=acme-bridge-poc-cdn
   export CF_DISTRIBUTION_ID=E1234567890ABC
   ```

### Deploy a build

```bash
cd poc/angular

# Build, generate manifest, upload to S3, invalidate manifest cache
npm run build:cdn
npm run deploy:s3
npm run invalidate:cf
```

This uploads all hashed bundles with `Cache-Control: public, max-age=31536000, immutable`. The `asset-manifest.json` is uploaded with `Cache-Control: no-cache` so SFCC always resolves the latest filenames for a given version.

### Versioned paths

Each version deploys to its own prefix:

```
s3://acme-bridge-poc-cdn/bridge-poc/0.0.1/main-3a7f2c.js
s3://acme-bridge-poc-cdn/bridge-poc/0.0.2/main-9b1e4d.js
```

Old versions remain cached at the edge indefinitely. Rollback = change the version string in SFCC Site Preferences.

## SFCC Integration

### Cartridge setup

1. Copy `sfcc/bridgepoc.isml` to your cartridge:
   ```
   plugin_acme_creativelabs/
   └── cartridge/
       └── templates/
           └── default/
               └── bridgepoc.isml
   ```

2. Create a controller (or add a route) to render the template:
   ```javascript
   // BridgePoc.js
   var server = require('server');

   server.get('Show', function (req, res, next) {
       res.render('bridgepoc');
       next();
   });

   module.exports = server.exports();
   ```

3. Register the route in the cartridge's `cartridges.properties` and add it to the site's cartridge path.

### Site Preferences

Create two custom site preferences in Business Manager:

| Preference ID       | Type   | Value (sandbox)                                            |
|----------------------|--------|------------------------------------------------------------|
| `bridgePocCdnBase`  | String | `https://d1234567890.cloudfront.net/bridge-poc`            |
| `bridgePocVersion`  | String | `0.0.1`                                                    |

The ISML template reads these to construct the CDN URLs. To deploy a new Angular build, update `bridgePocVersion` — no cartridge redeploy required.

### Testing on sandbox

1. Upload the cartridge to your SFCC sandbox
2. Set the Site Preferences to point at your CloudFront distribution
3. Navigate to `https://[sandbox-hostname]/en-us/bridgepoc`
4. Verify:
   - The component renders inside a shadow root (DevTools → Elements → `#shadow-root (open)`)
   - Clicking "Add to Cart" dispatches `ds:add-to-cart` (visible in the event log)
   - The SFCC `Cart-AddProduct` endpoint receives the request with `dwsid` cookie
   - The minicart flyout opens (jQuery trigger fires)
   - The cart badge updates (jQuery trigger fires)
   - The component shows the cart response (item count, total)
   - SFRA styles (header, footer, nav) are unaffected by Angular's styles
   - Angular's styles are unaffected by SFRA's stylesheets

### CSRF note

The bridge script looks for a CSRF token via `input[name="csrf_token"]` or `meta[name="csrf-token"]`. SFRA's CSRF implementation varies by cartridge setup. If `Cart-AddProduct` returns a 403, check that the CSRF token is accessible on the shell page and adjust the selector in the ISML bridge script accordingly.

## Validating the Architecture

This PoC proves or disproves the following claims from the architecture document:

| Claim | How to verify |
|-------|---------------|
| Shadow DOM isolates CSS | Add a conflicting `.poc-card { background: red }` to SFRA's global CSS. Angular's card should remain white. |
| Shadow DOM isolates DOM | Run `document.querySelector('.poc-card')` in the console. It should return `null` (element is behind shadow root). |
| Zoneless Angular doesn't break jQuery | Open any PDP on the same site, add to cart, confirm minicart still works. Zone.js is not loaded globally. |
| CustomEvents cross shadow boundary | Watch the event log in the component and `console.log` in the bridge listener — both should fire on click. |
| `composed: true` is required | Temporarily remove `composed: true` from the bridge service. The host listener should stop receiving events. |
| CDN bundles cache independently | Deploy Angular v0.0.2, update Site Preference. Old pages still serve v0.0.1 from edge until cache expires or is invalidated. |
| SFCC session cookies attach automatically | Inspect the `Cart-AddProduct` request in Network tab — `dwsid` and `dwsecuretoken_*` cookies should be present with no explicit credential handling. |

## Graduating to Production

When the PoC validates, the path to the full App integration is:

1. Replace `acme-bridge-poc` with `acme-app` (full Angular app with canvas, artboard, project routing)
2. Add `ds:resolve-project` handler to the bridge (calls `AcmeBridge-ResolveProject` controller)
3. Add `ds:project-saved` handler (cache eviction)
4. Move CDN base from PoC bucket to `cdn.acme.com/app/`
5. Add `fonts.css` to CDN, load in parent `<head>`
6. Add Auth0 config attributes to the custom element
7. Swap hardcoded demo product for real material resolution flow

The bridge listener pattern, Shadow DOM encapsulation, CDN loading, and jQuery sync mechanism carry forward unchanged.
