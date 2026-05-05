import { InjectionToken, type Signal } from '@angular/core';
import { CONTRACT_VERSION, type DsAddToCartPayload, type DsCartResponsePayload, type DsDesignProductSelectedPayload } from '@cricut/ds-sfcc-contract';

export type BridgeRuntimeMode = 'iframe' | 'custom-event';
export type BootstrapStatus = 'received' | 'pending' | 'n/a';

export interface BridgeTransport {
  readonly mode: BridgeRuntimeMode;
  readonly modeLabel: string;
  readonly contractVersion: string;
  readonly parentOriginLabel: string;
  readonly isEmbedded: boolean;
  readonly bootstrapStatus: Signal<BootstrapStatus>;
  readonly selectedProduct: Signal<DsDesignProductSelectedPayload | null>;
  initialize(hostElement: HTMLElement): void;
  addToCart(payload: DsAddToCartPayload): Promise<DsCartResponsePayload>;
  resolveProject(projectId: string): void;
  resize(height: number): void;
  projectSaved(projectId: string): void;
}

export const BRIDGE_TRANSPORT = new InjectionToken<BridgeTransport>('BRIDGE_TRANSPORT');

export function createMockCartResponse(qty: number): DsCartResponsePayload {
  return {
    success: true,
    basketId: 'mock-basket',
    cartItemCount: qty,
  };
}

export const BRIDGE_CONTRACT_VERSION = CONTRACT_VERSION;