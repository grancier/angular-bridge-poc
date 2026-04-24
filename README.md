# Bridge PoC — Angular Elements + Shadow DOM + CustomEvent

Minimal proof-of-concept that validates the Angular Elements architecture for embedding Angular inside SFCC's SFRA storefront. One button, one product, full event lifecycle — no App dependencies.

## What This Proves

1. **Shadow DOM isolation** — Angular styles don't leak into SFRA; SFRA styles don't leak into Angular.
2. **Zoneless Angular** — No Zone.js. SFRA's jQuery event loop is unaffected.
3. **Shadow-root fetch to SFRA** — the component calls `Cart-AddProduct` directly from inside the shadow root with `credentials: 'include'`, so the SFCC session cookie attaches automatically. No host-page script required for add-to-cart.
4. **CustomEvent bridge (available for host-driven flows)** — `SfccBridgeService` still exposes `resize`, `projectSaved`, and `resolveProject` helpers that dispatch `composed: true` events. Not exercised by the current PoC button but wired up for the real App integration.
5. **CDN-hosted bundles** — Angular loads from an external CDN, not cartridge static assets. Zero build coupling.
6. **Independent deployment** — Angular deploys to S3/CloudFront. SFCC deploys its cartridge. The only sync point is a version string in Site Preferences.

## Project Structure

```
angular-bridge-poc/
├── main.ts                     # Single-file Angular app: component + bridge service + bootstrap
├── index.html                  # Local test page (template; renders to .rendered/index.html)
├── bridgepoc.isml              # SFCC cartridge template: custom element + bridge listener
│
├── angular.json                # CLI config: ESM output, hashed filenames, no index.html
├── tsconfig.json               # TS config: ES2022, strict, bundler resolution
├── package.json                # Dependencies + build/deploy/render scripts
│
├── env-example                 # Template env file — copy to .env and fill in
│
├── bucket-policy.json          # S3 bucket policy (uses ${VAR} placeholders)
├── cf-distro-config.json       # CloudFront distribution config (uses ${VAR} placeholders)
├── cors-config.json            # S3 CORS rules (uses ${VAR} placeholders)
│
├── scripts/
│   ├── prepare-cdn.mjs         # Post-build: writes asset-manifest.json
│   └── render-config.mjs       # Substitutes ${VAR} / ${VAR[]} / ${BUNDLE_MAIN} → .rendered/
│
├── .rendered/                  # Render output (gitignored) — concrete files for AWS CLI / npx serve
└── dist/                       # Build output (gitignored)
```

## Prerequisites

- Node.js >= 20.x
- Angular CLI 21.x (`npm install -g @angular/cli@21`)
- AWS CLI configured with credentials for the target S3 bucket
- SFCC sandbox with cartridge upload access

### Environment setup

Templates in this repo (config JSON, test HTML) use `${VAR}` placeholders that are resolved at render time from a local `.env` file. The `.env` file is gitignored; `env-example` is the committed reference.

```bash
npm install
cp env-example .env
# Edit .env with your AWS values
```

Required variables (see [env-example](env-example) for descriptions):

| Variable | Purpose |
|---|---|
| `CDN_BUCKET` | S3 bucket that stores the built bundle |
| `AWS_REGION` | Region for the S3 origin domain |
| `AWS_ACCOUNT_ID` | Owner of the CloudFront distribution |
| `CF_DISTRIBUTION_ID` | CloudFront distribution ID |
| `CF_DOMAIN` | CloudFront domain (browsers hit this) |
| `CF_OAC_ID` | Origin Access Control ID |
| `CF_RESPONSE_HEADERS_POLICY_ID` | CloudFront response-headers policy (defaults to AWS-managed `Managed-SimpleCORS`) |
| `ALLOWED_ORIGINS` | Comma-separated storefront origins for S3 CORS rules |

Template files that reference these: [bucket-policy.json](bucket-policy.json), [cf-distro-config.json](cf-distro-config.json), [cors-config.json](cors-config.json), [index.html](index.html).

## Build

```bash
# Production build (optimized, hashed filenames, ESM output, writes asset-manifest.json)
npm run build:cdn
```

The production build outputs to `dist/acme-bridge-poc/browser/`:

```
dist/acme-bridge-poc/browser/
├── main-[hash].js              # Angular application bundle
└── asset-manifest.json         # Maps logical names to hashed filenames
```

`main-[hash].js` rotates per build. The hash is auto-substituted into [index.html](index.html) via the `${BUNDLE_MAIN}` placeholder during the render step.

## Local Development

Two ways to run the app locally:

**1. `ng serve` — mock cart mode (no AWS needed)**

```bash
npm run serve
```

Open `http://localhost:4200`. The `SfccBridgeService` detects no `cart-endpoint` attribute and returns mock cart responses. Useful for UI iteration without SFRA running.

**2. `npm run serve:test` — load the deployed CDN bundle**

```bash
npm run build:cdn        # produce a fresh asset-manifest.json
npm run deploy:s3        # (optional) push to S3 if you haven't already
npm run serve:test       # renders templates + serves .rendered/ at :3000
```

Open `http://localhost:3000/index.html`. This serves the rendered `index.html` (with concrete `CF_DOMAIN` and `BUNDLE_MAIN` substituted), loading the Angular bundle cross-origin from your CloudFront distribution — the closest local approximation of the SFRA embedding.

To verify Shadow DOM isolation, inspect the element in DevTools: you should see `#shadow-root (open)` under `<acme-bridge-poc>`. Styles defined inside the component are not visible in the parent document's stylesheet list.

## Deploy to AWS (S3 + CloudFront)

Assumes [environment setup](#environment-setup) is complete.

### One-time AWS resource setup

1. **S3 bucket** — Create a private bucket (public access blocked). CloudFront serves as the public edge.

2. **CloudFront distribution** — Create with:
   - Origin: the S3 bucket (use OAC, not OAI)
   - Default cache behavior: `Cache-Control` header from origin
   - Response headers policy: CORS allowing your storefront origins (see [cors-config.json](cors-config.json))
   - Custom domain (optional): your CDN hostname with wildcard cert

3. **Apply rendered configs** — render the templates into `.rendered/`, then pass them to the AWS CLI:
   ```bash
   npm run config:render
   aws s3api put-bucket-policy --bucket "$CDN_BUCKET" --policy file://.rendered/bucket-policy.json
   aws s3api put-bucket-cors   --bucket "$CDN_BUCKET" --cors-configuration file://.rendered/cors-config.json
   aws cloudfront create-distribution --distribution-config file://.rendered/cf-distro-config.json
   ```

### Deploy a build

```bash
# Build, upload to S3, invalidate manifest cache.
# deploy:s3 and invalidate:cf auto-load values from .env.
npm run build:cdn
npm run deploy:s3
npm run invalidate:cf
```

Hashed bundles upload with `Cache-Control: public, max-age=31536000, immutable`. The `asset-manifest.json` uploads with `Cache-Control: no-cache` so SFCC always resolves the latest filename for a given version.

### Versioned paths

Each version deploys to its own prefix:

```
s3://$CDN_BUCKET/bridge-poc/0.0.1/main-3a7f2c.js
s3://$CDN_BUCKET/bridge-poc/0.0.2/main-9b1e4d.js
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
| `bridgePocCdnBase`  | String | `https://<your-cdn-domain>/bridge-poc`                     |
| `bridgePocVersion`  | String | `0.0.1`                                                    |

The ISML template reads these to construct the CDN URLs. To deploy a new Angular build, update `bridgePocVersion` — no cartridge redeploy required.

### Testing on sandbox

1. Upload the cartridge to your SFCC sandbox
2. Set the Site Preferences to point at your CloudFront distribution
3. Navigate to `https://[sandbox-hostname]/en-us/bridgepoc`
4. Verify:
   - The component renders inside a shadow root (DevTools → Elements → `#shadow-root (open)`)
   - Clicking "Add to Cart" issues a `POST` to `Cart-AddProduct` from inside the shadow root (DevTools → Network)
   - The request carries the `dwsid` session cookie automatically (no explicit credential handling)
   - The component shows the SFRA cart response (quantity, grand total)
   - SFRA styles (header, footer, nav) are unaffected by Angular's styles
   - Angular's styles are unaffected by SFRA's stylesheets

### CSRF note

The bridge script looks for a CSRF token via `input[name="csrf_token"]` or `meta[name="csrf-token"]`. SFRA's CSRF implementation varies by cartridge setup. If `Cart-AddProduct` returns a 403, check that the CSRF token is accessible on the shell page and adjust the selector in the ISML bridge script accordingly.

## Validating the Architecture

This PoC proves or disproves the following claims from the architecture document:

| Claim | How to verify |
|-------|---------------|
| Shadow DOM isolates CSS | Add a conflicting `.poc-card { background: red }` to SFRA's global CSS. Angular's card should remain white. |
| Shadow DOM isolates DOM | Run `document.querySelector('.poc-card')` in the console — it should return `null` (element is behind shadow root). |
| Zoneless Angular doesn't break jQuery | Open any PDP on the same site, add to cart, confirm minicart still works. Zone.js is not loaded globally. |
| Shadow-root fetch reaches SFRA with session cookie | In the Network tab, confirm the `Cart-AddProduct` POST is initiated by the Angular bundle and carries `dwsid` (and `dwsecuretoken_*`) automatically — no explicit credential handling in the component. |
| CDN bundles cache independently per version | Bump `version` in `package.json`, redeploy, update the `bridgePocVersion` Site Preference. Old pages keep serving the prior version from the edge until its cache expires or is invalidated. |
| CustomEvent bridge helpers exist for host-driven flows | Inspect [main.ts](main.ts) — `SfccBridgeService.resize`, `projectSaved`, and `resolveProject` dispatch `composed: true` CustomEvents on the host element. Not wired to any UI in this PoC; wired for the full App integration. |

## Graduating to Production

When the PoC validates, the path to the full App integration is:

1. Replace `acme-bridge-poc` with `acme-app` (full Angular app with canvas, artboard, project routing)
2. Wire `ds:resolve-project` to a real `AcmeBridge-ResolveProject` controller
3. Wire `ds:project-saved` (cache eviction)
4. Move CDN base to your production distribution (new `.env` values)
5. Add `fonts.css` to CDN, load in parent `<head>`
6. Add Auth0 config attributes to the custom element
7. Swap hardcoded demo product for real material resolution flow

The shadow-root fetch pattern, CustomEvent bridge helpers, CDN loading, and SFCC session cookie flow carry forward unchanged.
