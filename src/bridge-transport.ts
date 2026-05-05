import { InjectionToken } from '@angular/core';
import { CONTRACT_VERSION, type DsAddToCartPayload, type DsCartResponsePayload } from '@cricut/ds-sfcc-contract';

export type BridgeRuntimeMode = 'iframe' | 'custom-event';

export interface BridgeTransport {
  readonly mode: BridgeRuntimeMode;
  readonly modeLabel: string;
  readonly contractVersion: string;
  readonly parentOriginLabel: string;
  readonly isEmbedded: boolean;
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