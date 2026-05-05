# Bridge PoC - iframe + CustomEvent runtimes

Minimal proof-of-concept for embedding a Cricut Design Space experience in SFCC. The repo now produces two explicit runtimes instead of mixing iframe and Shadow DOM behavior in one bundle.

## Runtime modes

| Mode | Entry | Transport | DOM boundary | Use case |
|---|---|---|---|---|
| `iframe` | `src/main.iframe.ts` | `window.postMessage` via `@cricut/ds-sfcc-contract/postmessage` | Cross-origin iframe, normal Angular SPA bootstrap | Preferred iframe architecture |
| `custom-event` | `src/main.custom-event.ts` | DOM `CustomEvent` via `@cricut/ds-sfcc-contract` | Angular Element with Shadow DOM | Legacy same-window bridge |

The iframe runtime uses `bootstrapApplication()` and does not use Angular Elements or Shadow DOM. The custom-event runtime is the only bundle that calls `createCustomElement()` and uses `ViewEncapsulation.ShadowDom`.

## What This Proves

1. Typed `postMessage` add-to-cart from a cross-origin iframe with explicit parent-origin validation.
2. The previous Shadow DOM / `CustomEvent` bridge remains available as an alternate runtime.
3. Both runtimes consume event names, payloads, contract version, and helpers from `@cricut/ds-sfcc-contract`.
4. `ds-loader.js` gives SFCC a small stable API: `window.__sfcc.mountCanvas()`.
5. Angular deploys independently to S3/CloudFront while SFCC owns cart, cookies, CSRF, and minicart sync.

## Project Structure

```text
angular-bridge-poc/
├── main.ts                         # Backward-compatible iframe default entry
├── index.html                      # Rendered CDN test shell template
├── loader/ds-loader.js             # Tiny loader exposing window.__sfcc.mountCanvas()
├── src/
│   ├── main.iframe.ts              # Normal Angular SPA bootstrap
│   ├── main.custom-event.ts        # Angular Element + Shadow DOM registration
│   ├── bridge-poc.component.ts     # Shared UI with encapsulation-specific variants
│   ├── bridge-transport.ts         # Runtime transport interface and DI token
│   ├── product.ts                  # Demo product data
│   └── transports/
│       ├── post-message.transport.ts
│       └── custom-event.transport.ts
├── scripts/prepare-cdn.mjs         # Writes dual-runtime asset-manifest.json
└── scripts/render-config.mjs       # Substitutes manifest/env placeholders into .rendered/
```

## Build

```bash
npm install
npm run build:cdn
```

The CDN build outputs both bundles and the loader:

```text
dist/acme-bridge-poc/browser/
├── ds-loader.js
├── asset-manifest.json
├── iframe/main-[hash].js
└── custom-event/main-[hash].js
```

The manifest exposes both explicit runtime entries:

```json
{
  "loader": "ds-loader.js",
  "iframe": { "main": "iframe/main-[hash].js" },
  "customEvent": { "main": "custom-event/main-[hash].js" }
}
```

## Loader API

Load `ds-loader.js`, then call `window.__sfcc.mountCanvas()` with an explicit mode and bundle URLs.

```html
<ds-canvas-host></ds-canvas-host>
<script src="https://cdn.example.com/bridge-poc/0.0.1/ds-loader.js"></script>
<script>
  window.__sfcc.mountCanvas({
    mode: 'iframe',
    root: 'ds-canvas-host',
    bundles: {
      iframe: 'https://cdn.example.com/bridge-poc/0.0.1/iframe/main-ABC123.js',
      'custom-event': 'https://cdn.example.com/bridge-poc/0.0.1/custom-event/main-XYZ789.js'
    }
  });
</script>
```

`mode` must be either `iframe` or `custom-event`. For local testing, `bridgeMode` or `dsMode` query params can select the mode when `mode` is omitted, but SFCC integration should pass it explicitly.

## Local Development

```bash
npm run build:cdn
npm run config:render
npm run serve:test
```

Open `http://localhost:3000/index.html`. The rendered shell loads the loader and iframe bundle from the configured CloudFront domain. Without a real SFCC iframe parent and `parentOrigin` query parameter, add-to-cart returns a contract-shaped mock response.

For direct Angular iteration:

```bash
npm run serve
```

The dev server exposes `main.js` but does not serve an index page because `angular.json` uses `index: false`. Use a small host page that includes `<ds-canvas-host>` and imports `http://localhost:4200/main.js`.

## SFCC iframe integration

The preferred iframe flow is:

1. SFCC renders a cross-origin iframe pointing at the CDN shell.
2. SFCC appends `parentOrigin=https%3A%2F%2F<sfcc-host>` to the iframe URL.
3. The child shell loads `ds-loader.js` and calls `mountCanvas({ mode: 'iframe', ... })`.
4. The iframe Angular app sends `ds:ready-for-bootstrap` to the exact `parentOrigin`.
5. SFCC replies with `ds:bootstrap`.
6. Add-to-cart uses `ds:add-to-cart` and `ds:cart-response` over typed `postMessage` helpers.

The iframe app never posts to `'*'`; the parent origin is normalized from the query string or `document.referrer` and all message listeners validate origin.

## Legacy custom-event integration

The legacy flow is same-window only:

1. SFCC loads `ds-loader.js` into the storefront page.
2. SFCC calls `mountCanvas({ mode: 'custom-event', ... })`.
3. The custom-event bundle registers `<ds-canvas-host>` as an Angular Element.
4. The component renders inside Shadow DOM.
5. Add-to-cart dispatches typed DOM events such as `ds:add-to-cart` and listens for `ds:cart-response`.

## Deploy to AWS

```bash
npm run build:cdn
npm run deploy:s3
npm run invalidate:cf
```

Hashed Angular bundles can be cached for a year. `asset-manifest.json` and `ds-loader.js` should be treated as short-cache control-plane files so SFCC can resolve the current runtime URLs for a version.

## Contract checkpoints

- Add-to-cart payloads use `DsAddToCartPayload` from `@cricut/ds-sfcc-contract`.
- Cart responses use `DsCartResponsePayload`.
- iframe messages use `postDsMessage()` and `onDsPostMessage()`.
- legacy events use `dispatchDsEvent()` and `onDsEvent()`.
- Both runtimes surface the contract version in the UI for smoke testing.