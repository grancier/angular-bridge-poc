import { ChangeDetectionStrategy, Component, ElementRef, Inject, ViewEncapsulation, computed, signal } from '@angular/core';
import type { DsAddToCartPayload } from '@cricut/ds-sfcc-contract';
import { BRIDGE_TRANSPORT, type BridgeTransport } from './bridge-transport';
import { PRODUCT, type Product } from './product';

const BRIDGE_POC_STYLES = `
  :host, ds-canvas-host {
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

  .poc-body { padding: 1.5rem; }

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

  .add-to-cart-btn:active:not(:disabled) { transform: translateY(0); }

  .add-to-cart-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .add-to-cart-btn.loading {
    background: #e0e0e0;
    color: #999;
  }

  .add-to-cart-btn.success { background: #2d8f6f; }
  .add-to-cart-btn.error { background: #d44; }

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

  .debug-entry .event-name { color: #7ec8e3; }
  .debug-entry .event-time { color: #666; }
  .debug-entry .event-detail { color: #c0c0c0; }
`;

const BRIDGE_POC_TEMPLATE = `
  <div class="poc-card">
    <div class="poc-header">
      <h2>Bridge PoC - {{ bridge.modeLabel }} + ds-sfcc-contract</h2>
    </div>

    <div class="poc-body">
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

      @if (statusMessage()) {
        <div class="status-bar"
             [class.info]="state() === 'success'"
             [class.error]="state() === 'error'"
             [class.mock]="statusMessage()?.includes('Mock')">
          {{ statusMessage() }}
        </div>
      }

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
      Runtime: {{ bridge.mode }}
      &middot; Embedded: {{ bridge.isEmbedded ? 'Yes' : 'No (standalone mode)' }}
      &middot; Transport: {{ bridge.modeLabel }}
      &middot; Contract: {{ bridge.contractVersion }}
      &middot; Parent: {{ bridge.parentOriginLabel }}
      &middot; Shadow DOM: {{ hasShadowRoot ? 'Active' : 'Inactive' }}
      &middot; Zone.js: Removed
    </div>
  </div>
`;

export abstract class BridgePocComponentBase {
  readonly product: Product = PRODUCT;
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
      case 'loading': return 'Adding to Cart...';
      case 'success': return 'Added to Cart';
      case 'error': return 'Failed - Retry';
      default: return 'Add to Cart';
    }
  });

  readonly hasShadowRoot: boolean;

  protected constructor(
    public readonly bridge: BridgeTransport,
    elRef: ElementRef<HTMLElement>,
  ) {
    this.bridge.initialize(elRef.nativeElement);
    this.hasShadowRoot = !!elRef.nativeElement.shadowRoot;
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
        this.logEvent('ds:cart-response', `success - ${msg}`);
      } else {
        this.state.set('error');
        const message = response.errorMessage || response.errorCode || 'Add to cart failed';
        this.statusMessage.set(message);
        this.logEvent('ds:cart-response', `error - ${message}`);
      }

      setTimeout(() => {
        if (this.state() !== 'loading') {
          this.state.set('idle');
        }
      }, 3000);
    } catch (err: unknown) {
      this.state.set('error');
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.statusMessage.set(message);
      this.logEvent('ds:cart-response', `error - ${message}`);
    }
  }

  private logEvent(name: string, summary: string): void {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
    this.eventLog.update(log => [
      { timestamp: now.getTime(), time, name, summary },
      ...log.slice(0, 19),
    ]);
  }
}

@Component({
  selector: 'ds-canvas-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [BRIDGE_POC_STYLES],
  template: BRIDGE_POC_TEMPLATE,
})
export class IframeBridgePocComponent extends BridgePocComponentBase {
  constructor(
    @Inject(BRIDGE_TRANSPORT) bridge: BridgeTransport,
    elRef: ElementRef<HTMLElement>,
  ) {
    super(bridge, elRef);
  }
}

@Component({
  selector: 'ds-canvas-host',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [BRIDGE_POC_STYLES],
  template: BRIDGE_POC_TEMPLATE,
})
export class CustomEventBridgePocComponent extends BridgePocComponentBase {
  constructor(
    @Inject(BRIDGE_TRANSPORT) bridge: BridgeTransport,
    elRef: ElementRef<HTMLElement>,
  ) {
    super(bridge, elRef);
  }
}