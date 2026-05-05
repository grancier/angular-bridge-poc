// =============================================================================
// acme-bridge-poc — Single-file Angular Elements proof-of-concept
// =============================================================================
//
// Proves: Shadow DOM encapsulation, zoneless change detection, typed postMessage
// bridge to the SFCC host, CDN-hosted bundles, HTML attribute configuration.
//
// This file contains everything: the bridge service, the root component,
// the Angular application bootstrap, and the custom element registration.
// No App dependencies — just a single add-to-cart button that
// exercises the full event lifecycle.
//
// Build output: ESM bundles deployed to CDN (AWS CloudFront + S3).
// Host: SFCC ISML template loads <acme-bridge-poc> custom element.
// =============================================================================

import { Component, Injectable, ElementRef, signal, computed, ChangeDetectionStrategy, ViewEncapsulation } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  CONTRACT_VERSION,
  type DsAddToCartPayload,
  type DsCartResponsePayload,
  type DsProjectSavedPayload,
  type DsResolveProjectPayload,
  type DsResizePayload,
  type SfccBootstrapConfig,
} from '@cricut/ds-sfcc-contract';
import { onDsPostMessage, postDsMessage } from '@cricut/ds-sfcc-contract/postmessage';

// =============================================================================
// 1. Product Data — demo payload for the cart contract
// =============================================================================

/** Product tile data — in production this comes from SFCC pdict */
interface Product {
  id: string;
  name: string;
  image: string;
  price: string;
  brand: string;
  url: string;
  quantity: number;
  availability: string;
  category: string;
  variant: string;
  variantId: string;
  projectId: string;
  designAssetUrl: string;
}

const PRODUCT: Product = {
  id: '2011084-base',
  name: 'Cricut Maker® 4',
  image: 'https://cricut.com/dw/image/v2/BHBM_PRD/on/demandware.static/-/Sites-cricut-master-catalog/default/dwc0a445f4/Maker4/Maker4_Updates/1_Hero_2011084_Maker4_Seashell.jpg?sw=600&q=65',
  price: '399.00',
  brand: 'cricut',
  url: 'https://cricut.com/en-us/cutting-machines/cricut-maker/cricut-maker-4/cricut-maker-4/2011084.html',
  quantity: 1,
  availability: 'InStock',
  category: 'machines_cricut-maker-machines',
  variant: 'Machine Only',
  variantId: '2011084',
  projectId: 'bridge-poc-project',
  designAssetUrl: 'https://cricut.com/dw/image/v2/BHBM_PRD/on/demandware.static/-/Sites-cricut-master-catalog/default/dwc0a445f4/Maker4/Maker4_Updates/1_Hero_2011084_Maker4_Seashell.jpg?sw=600&q=65',
};

// =============================================================================
// 2. SfccBridgeService — the only commerce communication channel
// =============================================================================
//
// When embedded inside the SFCC iframe host, posts typed ds:* envelopes to the
// parent window and validates responses against the parent origin. When running
// standalone (ng serve), returns mock responses so development works without SFCC.
// =============================================================================

@Injectable({ providedIn: 'root' })
export class SfccBridgeService {

  private hostElement: HTMLElement | null = null;
  private readonly DEFAULT_TIMEOUT_MS = 5000;
  private readonly parentOrigin = this.resolveParentOrigin();
  private bootstrapConfig: SfccBootstrapConfig | null = null;
  private bootstrapCleanup: (() => void) | null = null;
  private readyForBootstrapSent = false;

  /**
   * Detect whether we're running inside the SFCC iframe host page.
   * SFCC appends parentOrigin=https://host to the iframe URL. Without that
   * explicit origin, the app stays in standalone mock mode.
   */
  get isEmbedded(): boolean {
    return window.parent !== window && this.parentOrigin !== null;
  }

  get contractVersion(): string {
    return CONTRACT_VERSION;
  }

  get parentOriginLabel(): string {
    return this.parentOrigin ?? 'standalone';
  }

  /** Called once during bootstrap to bind to the host element and handshake. */
  setHostElement(el: HTMLElement): void {
    this.hostElement = el;
    this.startBootstrapHandshake();
  }

  /**
   * Add a single product/design to the SFRA cart.
   *
   * Posts ds:add-to-cart to the SFCC parent and awaits ds:cart-response.
   * The parent page owns the SFCC bridge, cookies, and minicart sync;
   * Angular stays commerce-agnostic and consumes the shared contract package.
   */
  addToCart(payload: DsAddToCartPayload): Promise<DsCartResponsePayload> {
    return this.postAndAwaitCartResponse(payload, this.DEFAULT_TIMEOUT_MS);
  }

  /**
   * Ask the SFCC parent to resolve a project. The PoC does not await a response,
   * but the outbound message shape is enforced by ds-sfcc-contract.
   */
  resolveProject(projectId: string): void {
    const payload: DsResolveProjectPayload = { projectId };
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    postDsMessage(window.parent, 'ds:resolve-project', payload, parentOrigin);
  }

  /** Notify host of content height change for container sizing */
  resize(height: number): void {
    const payload: DsResizePayload = { height };
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    postDsMessage(window.parent, 'ds:resize', payload, parentOrigin);
  }

  /** Signal project save so host can bust manifest cache */
  projectSaved(projectId: string): void {
    const payload: DsProjectSavedPayload = {
      projectId,
      savedAt: new Date().toISOString(),
    };
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    postDsMessage(window.parent, 'ds:project-saved', payload, parentOrigin);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private startBootstrapHandshake(): void {
    if (!this.isEmbedded || !this.parentOrigin || this.readyForBootstrapSent) return;

    this.readyForBootstrapSent = true;
    this.bootstrapCleanup = onDsPostMessage(
      window,
      'ds:bootstrap',
      this.parentOrigin,
      (payload) => {
        this.bootstrapConfig = payload.config;
        console.info('[SfccBridge] Received SFCC bootstrap config', this.bootstrapConfig);
      },
    );

    postDsMessage(
      window.parent,
      'ds:ready-for-bootstrap',
      { contractVersion: CONTRACT_VERSION },
      this.parentOrigin,
    );
  }

  private postAndAwaitCartResponse(
    payload: DsAddToCartPayload,
    timeoutMs: number
  ): Promise<DsCartResponsePayload> {

    // Standalone mode: return a mock contract-shaped response for local development
    if (!this.isEmbedded) {
      console.warn('[SfccBridge] Not embedded — mocking ds:cart-response');
      return Promise.resolve({
        success: true,
        basketId: 'mock-basket',
        cartItemCount: payload.qty,
      });
    }

    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) {
      return Promise.reject(new Error('Missing parentOrigin; refusing to post ds:add-to-cart'));
    }

    return new Promise<DsCartResponsePayload>((resolve, reject) => {
      let stopListening: (() => void) | null = null;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge timeout: no ds:cart-response postMessage within ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (stopListening) {
          stopListening();
          stopListening = null;
        }
      };

      stopListening = onDsPostMessage(window, 'ds:cart-response', parentOrigin, (response) => {
        cleanup();
        resolve(response);
      });

      postDsMessage(window.parent, 'ds:add-to-cart', payload, parentOrigin);
    });
  }

  private getActiveParentOrigin(): string | null {
    if (!this.isEmbedded || !this.parentOrigin) return null;
    return this.parentOrigin;
  }

  private resolveParentOrigin(): string | null {
    const queryValue = new URLSearchParams(window.location.search).get('parentOrigin');
    const queryOrigin = this.normalizeOrigin(queryValue);
    if (queryOrigin) return queryOrigin;

    return this.normalizeOrigin(document.referrer);
  }

  private normalizeOrigin(value: string | null): string | null {
    if (!value) return null;

    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return url.origin;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// 3. Root Component — single add-to-cart button
// =============================================================================
//
// ViewEncapsulation.ShadowDom: the browser attaches a shadow root to this
// component's host element. All styles are scoped. No CSS leaks in or out.
// Cross-frame commerce events use window.postMessage, not DOM CustomEvents.
//
// ChangeDetectionStrategy.OnPush + zoneless: no Zone.js, no dirty checking
// of the SFRA host page. Change detection runs on signal updates only.
// =============================================================================

@Component({
  selector: 'acme-bridge-poc',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* ---------------------------------------------------------------
       All styles are encapsulated inside the shadow root.
       They cannot leak into the SFRA host page.
       The SFRA host page's styles cannot reach in here.
       --------------------------------------------------------------- */

    :host {
      display: block;
      font-family: 'DM Sans', system-ui, sans-serif;
      color: #2d2d2d;
    }

    .poc-card {
      max-width: 480px;
      margin: 2rem auto;
      border: 1px solid #e2e2e2;
      border-radius: 12px;
      overflow: hidden;
      background: #ffffff;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    }

    .poc-header {
      padding: 1.25rem 1.5rem;
      background: #f8f9fa;
      border-bottom: 1px solid #e2e2e2;
    }

    .poc-header h2 {
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
    }

    .poc-body {
      padding: 1.5rem;
    }

    .product-row {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .product-image {
      width: 96px;
      height: 96px;
      border-radius: 8px;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .product-image img {
      max-width: 80%;
      max-height: 80%;
      object-fit: contain;
    }

    .product-image .placeholder-icon {
      font-size: 2rem;
      color: #ccc;
    }

    .product-info {
      flex: 1;
      min-width: 0;
    }

    .product-name {
      margin: 0 0 0.25rem;
      font-size: 1rem;
      font-weight: 600;
      color: #2d2d2d;
    }

    .product-pid {
      margin: 0 0 0.5rem;
      font-size: 0.8rem;
      color: #999;
      font-family: 'DM Mono', monospace;
    }

    .product-price {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: #00c08b;
    }

    .add-to-cart-btn {
      display: block;
      width: 100%;
      padding: 0.85rem;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
      background: #00c08b;
      color: #fff;
    }

    .add-to-cart-btn:hover:not(:disabled) {
      background: #00a87a;
      transform: translateY(-1px);
    }

    .add-to-cart-btn:active:not(:disabled) {
      transform: translateY(0);
    }

    .add-to-cart-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .add-to-cart-btn.loading {
      background: #e0e0e0;
      color: #999;
    }

    .add-to-cart-btn.success {
      background: #2d8f6f;
    }

    .add-to-cart-btn.error {
      background: #d44;
    }

    .status-bar {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      line-height: 1.4;
    }

    .status-bar.info {
      background: #f0f9f6;
      color: #2d8f6f;
      border: 1px solid #c8ede1;
    }

    .status-bar.error {
      background: #fef2f2;
      color: #c44;
      border: 1px solid #fcd5d5;
    }

    .status-bar.mock {
      background: #fffbeb;
      color: #92730a;
      border: 1px solid #fde68a;
    }

    .poc-footer {
      padding: 1rem 1.5rem;
      background: #f8f9fa;
      border-top: 1px solid #e2e2e2;
      font-size: 0.75rem;
      color: #aaa;
      text-align: center;
    }

    .debug-events {
      margin-top: 1rem;
      padding: 1rem;
      background: #1a1a2e;
      border-radius: 8px;
      max-height: 200px;
      overflow-y: auto;
    }

    .debug-events h3 {
      margin: 0 0 0.5rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
    }

    .debug-entry {
      font-family: 'DM Mono', monospace;
      font-size: 0.75rem;
      line-height: 1.6;
      color: #b0b0d0;
    }

    .debug-entry .event-name {
      color: #7ec8e3;
    }

    .debug-entry .event-time {
      color: #666;
    }

    .debug-entry .event-detail {
      color: #c0c0c0;
    }
  `],
  template: `
    <div class="poc-card">
      <div class="poc-header">
        <h2>Bridge PoC — postMessage + ds-sfcc-contract</h2>
      </div>

      <div class="poc-body">
        <!-- Product display -->
        <div class="product-row">
          <div class="product-image">
            <img [src]="product.image" [alt]="product.name" />
          </div>
          <div class="product-info">
            <p class="product-name">
              <a [href]="product.url" target="_blank" rel="noopener">{{ product.name }}</a>
            </p>
            <p class="product-pid">PID: {{ product.variantId }} &middot; {{ product.variant }}</p>
            <p class="product-price">\${{ product.price }}</p>
          </div>
        </div>

        <!-- The single add-to-cart button that exercises the full event lifecycle -->
        <button
          class="add-to-cart-btn"
          [class.loading]="state() === 'loading'"
          [class.success]="state() === 'success'"
          [class.error]="state() === 'error'"
          [disabled]="state() === 'loading'"
          (click)="onAddToCart()"
        >
          {{ buttonLabel() }}
        </button>

        <!-- Status feedback -->
        @if (statusMessage()) {
          <div class="status-bar"
               [class.info]="state() === 'success'"
               [class.error]="state() === 'error'"
               [class.mock]="statusMessage()?.includes('Mock')">
            {{ statusMessage() }}
          </div>
        }

        <!-- Event log — proves events are dispatching correctly -->
        @if (eventLog().length > 0) {
          <div class="debug-events">
            <h3>Event Log</h3>
            @for (entry of eventLog(); track entry.timestamp) {
              <div class="debug-entry">
                <span class="event-time">{{ entry.time }}</span>
                <span class="event-name"> {{ entry.name }}</span>
                <span class="event-detail"> {{ entry.summary }}</span>
              </div>
            }
          </div>
        }
      </div>

      <div class="poc-footer">
        Embedded: {{ bridge.isEmbedded ? 'Yes (SFCC iframe host)' : 'No (standalone mode)' }}
        &middot; Transport: {{ bridge.isEmbedded ? 'postMessage' : 'mock' }}
        &middot; Contract: {{ bridge.contractVersion }}
        &middot; Parent: {{ bridge.parentOriginLabel }}
        &middot; Shadow DOM: {{ hasShadowRoot ? 'Active' : 'Inactive' }}
        &middot; Zone.js: Removed
      </div>
    </div>
  `,
})
export class BridgePocComponent {

  readonly product: Product = PRODUCT;

  // Reactive state via signals — no Zone.js, no implicit change detection
  readonly state = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  readonly statusMessage = signal<string | null>(null);
  readonly eventLog = signal<Array<{
    timestamp: number;
    time: string;
    name: string;
    summary: string;
  }>>([]);

  readonly buttonLabel = computed(() => {
    switch (this.state()) {
      case 'loading': return 'Adding to Cart…';
      case 'success': return 'Added to Cart ✓';
      case 'error':   return 'Failed — Retry';
      default:        return 'Add to Cart';
    }
  });

  readonly hasShadowRoot: boolean;

  constructor(
    public readonly bridge: SfccBridgeService,
    private readonly elRef: ElementRef<HTMLElement>,
  ) {
    // Bind the bridge to this element so events dispatch on the custom element
    this.bridge.setHostElement(this.elRef.nativeElement);
    this.hasShadowRoot = !!this.elRef.nativeElement.shadowRoot;
  }

  async onAddToCart(): Promise<void> {
    this.state.set('loading');
    this.statusMessage.set(null);
    this.logEvent('ds:add-to-cart', `sku=${this.product.variantId} qty=${this.product.quantity}`);

    try {
      const payload: DsAddToCartPayload = {
        sku: this.product.variantId,
        qty: this.product.quantity,
        projectId: this.product.projectId,
        designAssetUrl: this.product.designAssetUrl,
        previewUrl: this.product.image,
      };

      const response = await this.bridge.addToCart(payload);

      if (response.success) {
        this.state.set('success');
        const msg = response.cartItemCount !== undefined
          ? `Added! Cart: ${response.cartItemCount} item(s)`
          : 'Added to cart';
        this.statusMessage.set(msg);
        this.logEvent('ds:cart-response', `success — ${msg}`);
      } else {
        this.state.set('error');
        const message = response.errorMessage || response.errorCode || 'Add to cart failed';
        this.statusMessage.set(message);
        this.logEvent('ds:cart-response', `error — ${message}`);
      }

      // Reset button state after 3 seconds
      setTimeout(() => {
        if (this.state() !== 'loading') {
          this.state.set('idle');
        }
      }, 3000);

    } catch (err: unknown) {
      this.state.set('error');
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.statusMessage.set(message);
      this.logEvent('ds:cart-response', `error — ${message}`);
    }
  }

  private logEvent(name: string, summary: string): void {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
    this.eventLog.update(log => [
      { timestamp: now.getTime(), time, name, summary },
      ...log.slice(0, 19), // keep last 20 entries
    ]);
  }
}

// =============================================================================
// 4. Bootstrap — Angular Elements custom element registration
// =============================================================================
//
// No platformBrowserDynamic().bootstrapModule(). Angular Elements registers
// a custom element with the browser, and the browser upgrades <acme-bridge-poc>
// when it appears in the DOM. Shadow DOM is declared via ViewEncapsulation.ShadowDom
// on the component; the iframe bridge uses postMessage for cross-origin events.
// =============================================================================

(async () => {
  const app = await createApplication({
    providers: [
      provideZonelessChangeDetection(),
    ],
  });

  const injector = app.injector;

  const BridgePocElement = createCustomElement(BridgePocComponent, { injector });

  // Register with the browser — from this point, any <acme-bridge-poc> in the
  // DOM is upgraded to a full Angular application with its own shadow root.
  if (!customElements.get('acme-bridge-poc')) {
    customElements.define('acme-bridge-poc', BridgePocElement);
  }
})();
