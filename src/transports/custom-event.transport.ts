import { Injectable } from '@angular/core';
import {
  CONTRACT_VERSION,
  dispatchDsEvent,
  onDsEvent,
  type DsAddToCartPayload,
  type DsCartResponsePayload,
  type DsProjectSavedPayload,
  type DsResolveProjectPayload,
  type DsResizePayload,
} from '@cricut/ds-sfcc-contract';
import { type BridgeTransport, createMockCartResponse } from '../bridge-transport';

@Injectable()
export class CustomEventBridgeTransport implements BridgeTransport {
  readonly mode = 'custom-event' as const;
  readonly modeLabel = 'CustomEvent';
  readonly contractVersion = CONTRACT_VERSION;
  readonly parentOriginLabel = 'same-window';

  private readonly defaultTimeoutMs = 5000;
  private hostElement: HTMLElement | null = null;

  get isEmbedded(): boolean {
    return this.hostElement?.closest('[data-sfcc-bridge]') !== null;
  }

  initialize(hostElement: HTMLElement): void {
    this.hostElement = hostElement;
  }

  addToCart(payload: DsAddToCartPayload): Promise<DsCartResponsePayload> {
    if (!this.hostElement || !this.isEmbedded) {
      console.warn('[SfccBridge] CustomEvent host not detected - mocking ds:cart-response');
      return Promise.resolve(createMockCartResponse(payload.qty));
    }

    const hostElement = this.hostElement;

    return new Promise<DsCartResponsePayload>((resolve, reject) => {
      let stopListening: (() => void) | null = null;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge timeout: no ds:cart-response CustomEvent within ${this.defaultTimeoutMs}ms`));
      }, this.defaultTimeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (stopListening) {
          stopListening();
          stopListening = null;
        }
      };

      stopListening = onDsEvent(hostElement, 'ds:cart-response', (response) => {
        cleanup();
        resolve(response);
      });

      dispatchDsEvent(hostElement, 'ds:add-to-cart', payload);
    });
  }

  resolveProject(projectId: string): void {
    if (!this.hostElement) return;
    const payload: DsResolveProjectPayload = { projectId };
    dispatchDsEvent(this.hostElement, 'ds:resolve-project', payload);
  }

  resize(height: number): void {
    if (!this.hostElement) return;
    const payload: DsResizePayload = { height };
    dispatchDsEvent(this.hostElement, 'ds:resize', payload);
  }

  projectSaved(projectId: string): void {
    if (!this.hostElement) return;
    const payload: DsProjectSavedPayload = {
      projectId,
      savedAt: new Date().toISOString(),
    };
    dispatchDsEvent(this.hostElement, 'ds:project-saved', payload);
  }
}