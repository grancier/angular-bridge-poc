import { Injectable } from '@angular/core';
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
import { type BridgeTransport, createMockCartResponse } from '../bridge-transport';

@Injectable()
export class PostMessageBridgeTransport implements BridgeTransport {
  readonly mode = 'iframe' as const;
  readonly modeLabel = 'postMessage';
  readonly contractVersion = CONTRACT_VERSION;

  private readonly defaultTimeoutMs = 5000;
  private readonly parentOrigin = this.resolveParentOrigin();
  private bootstrapConfig: SfccBootstrapConfig | null = null;
  private bootstrapCleanup: (() => void) | null = null;
  private readyForBootstrapSent = false;

  get isEmbedded(): boolean {
    return window.parent !== window && this.parentOrigin !== null;
  }

  get parentOriginLabel(): string {
    return this.parentOrigin ?? 'standalone';
  }

  initialize(): void {
    this.startBootstrapHandshake();
  }

  addToCart(payload: DsAddToCartPayload): Promise<DsCartResponsePayload> {
    if (!this.isEmbedded) {
      console.warn('[SfccBridge] Not embedded - mocking ds:cart-response');
      return Promise.resolve(createMockCartResponse(payload.qty));
    }

    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) {
      return Promise.reject(new Error('Missing parentOrigin; refusing to post ds:add-to-cart'));
    }

    return new Promise<DsCartResponsePayload>((resolve, reject) => {
      let stopListening: (() => void) | null = null;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge timeout: no ds:cart-response postMessage within ${this.defaultTimeoutMs}ms`));
      }, this.defaultTimeoutMs);

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

  resolveProject(projectId: string): void {
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    const payload: DsResolveProjectPayload = { projectId };
    postDsMessage(window.parent, 'ds:resolve-project', payload, parentOrigin);
  }

  resize(height: number): void {
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    const payload: DsResizePayload = { height };
    postDsMessage(window.parent, 'ds:resize', payload, parentOrigin);
  }

  projectSaved(projectId: string): void {
    const parentOrigin = this.getActiveParentOrigin();
    if (!parentOrigin) return;
    const payload: DsProjectSavedPayload = {
      projectId,
      savedAt: new Date().toISOString(),
    };
    postDsMessage(window.parent, 'ds:project-saved', payload, parentOrigin);
  }

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