// =============================================================================
// acme-bridge-poc — Single-file Angular Elements proof-of-concept
// =============================================================================
//
// Proves: Shadow DOM encapsulation, zoneless change detection, CustomEvent
// bridge to SFCC host, CDN-hosted bundles, HTML attribute configuration.
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
import { bootstrapApplication, createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { provideZonelessChangeDetection, ApplicationRef, Injector } from '@angular/core';

// =============================================================================
// 1. Bridge Types — mirrors @acme/app-bridge-types contract
// =============================================================================

/** Outbound event: request to add a single product to cart */
interface AddToCartRequest {
  pid: string;
  quantity: number;
}

/** Outbound event: request to resolve a full project into cart line items */
interface ResolveProjectRequest {
  projectId: string;
}

/** Outbound event: notify host of content height change */
interface ResizeRequest {
  height: number;
}

/** Inbound event: commerce response from SFCC host bridge */
interface CartResponse {
  success: boolean;
  error?: boolean;
  message?: string;
  itemsRequested?: number;
  itemsAdded?: number;
  itemsFailed?: Array<{ materialRef: string; reason: string }>;
  basket?: {
    itemCount: number;
    total: number;
    currency: string;
    promos?: string[];
  };
}

/** All bridge event names with ds: prefix */
type BridgeEvent =
  | 'ds:add-to-cart'
  | 'ds:resolve-project'
  | 'ds:resize'
  | 'ds:project-saved'
  | 'ds:cart-response';

// =============================================================================
// 2. SfccBridgeService — the only commerce communication channel
// =============================================================================
//
// When embedded inside SFCC, dispatches CustomEvents on the host element.
// When running standalone (ng serve), detects the missing host and returns
// mock responses so development works without SFCC.
// =============================================================================

@Injectable({ providedIn: 'root' })
export class SfccBridgeService {

  private hostElement: HTMLElement | null = null;
  private readonly DEFAULT_TIMEOUT_MS = 5000;
  private readonly RESOLVE_TIMEOUT_MS = 15000;

  /**
   * Detect whether we're running inside the SFCC host page.
   * The host attaches a bridge listener to the custom element and sets
   * a data attribute to signal readiness. If absent, we're standalone.
   */
  get isEmbedded(): boolean {
    return this.hostElement?.closest('[data-sfcc-bridge]') !== null;
  }

  /** Called once during bootstrap to bind to the host element */
  setHostElement(el: HTMLElement): void {
    this.hostElement = el;
  }

  /**
   * Add a single product to the SFCC cart.
   *
   * Dispatches ds:add-to-cart, waits for ds:cart-response.
   * Angular never calls an SFCC endpoint — it only knows the event contract.
   */
  addToCart(pid: string, quantity: number = 1): Promise<CartResponse> {
    const detail: AddToCartRequest = { pid, quantity };
    return this.dispatchAndAwaitResponse('ds:add-to-cart', detail, this.DEFAULT_TIMEOUT_MS);
  }

  /**
   * Resolve a full project into SFCC cart line items.
   * Longer timeout because the controller may call API-1 on cache miss.
   */
  resolveProject(projectId: string): Promise<CartResponse> {
    const detail: ResolveProjectRequest = { projectId };
    return this.dispatchAndAwaitResponse('ds:resolve-project', detail, this.RESOLVE_TIMEOUT_MS);
  }

  /** Notify host of content height change for container sizing */
  resize(height: number): void {
    this.dispatch('ds:resize', { height } as ResizeRequest);
  }

  /** Signal project save so host can bust manifest cache */
  projectSaved(projectId: string): void {
    this.dispatch('ds:project-saved', { projectId });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private dispatch(eventName: BridgeEvent, detail: unknown): void {
    if (!this.hostElement) return;

    // composed: true lets the event escape the shadow root.
    // bubbles: true lets it propagate up the DOM.
    this.hostElement.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  private dispatchAndAwaitResponse(
    eventName: BridgeEvent,
    detail: unknown,
    timeoutMs: number
  ): Promise<CartResponse> {

    // Standalone mode: return a mock response for local development
    if (!this.isEmbedded) {
      console.warn(`[SfccBridge] Not embedded — mocking response for ${eventName}`);
      return Promise.resolve({
        success: true,
        message: 'Mock response (standalone mode)',
        basket: { itemCount: 1, total: 29.99, currency: 'USD' },
      });
    }

    return new Promise<CartResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge timeout: no ds:cart-response within ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (e: Event) => {
        cleanup();
        resolve((e as CustomEvent<CartResponse>).detail);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.hostElement?.removeEventListener('ds:cart-response', handler);
      };

      // Listen on the host element for the correlated response
      this.hostElement?.addEventListener('ds:cart-response', handler, { once: true });

      // Fire the outbound event
      this.dispatch(eventName, detail);
    });
  }
}

// =============================================================================
// 3. Root Component — single add-to-cart button
// =============================================================================
//
// ViewEncapsulation.ShadowDom: the browser attaches a shadow root to this
// component's host element. All styles are scoped. No CSS leaks in or out.
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
        <h2>Bridge PoC — Shadow DOM + CustomEvent</h2>
      </div>

      <div class="poc-body">
        <!-- Product display -->
        <div class="product-row">
          <div class="product-image">
            <span class="placeholder-icon">&#9881;</span>
          </div>
          <div class="product-info">
            <p class="product-name">{{ productName }}</p>
            <p class="product-pid">PID: {{ productPid }}</p>
            <p class="product-price">\${{ productPrice }}</p>
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
        Embedded: {{ bridge.isEmbedded ? 'Yes (SFCC host detected)' : 'No (standalone mode)' }}
        &middot; Shadow DOM: {{ hasShadowRoot ? 'Active' : 'Inactive' }}
        &middot; Zone.js: Removed
      </div>
    </div>
  `,
})
export class BridgePocComponent {

  // Hard-coded demo product — in production, these come from SFCC pdict
  readonly productName = 'Acme Maker 3';
  readonly productPid = '2008334';
  readonly productPrice = '399.99';

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
    this.logEvent('ds:add-to-cart', `pid=${this.productPid} qty=1`);

    try {
      const response = await this.bridge.addToCart(this.productPid, 1);

      if (response.success) {
        this.state.set('success');
        const msg = response.basket
          ? `Added! Cart: ${response.basket.itemCount} items, ${response.basket.currency} ${response.basket.total}`
          : response.message || 'Added to cart';
        this.statusMessage.set(msg);
        this.logEvent('ds:cart-response', `success — ${msg}`);
      } else {
        this.state.set('error');
        this.statusMessage.set(response.message || 'Add to cart failed');
        this.logEvent('ds:cart-response', `error — ${response.message}`);
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
      this.logEvent('ds:cart-response', `timeout/error — ${message}`);
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
// on the component — the browser attaches the shadow root automatically on upgrade.
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
