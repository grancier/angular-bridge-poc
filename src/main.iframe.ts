import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BRIDGE_TRANSPORT } from './bridge-transport';
import { IframeBridgePocComponent } from './bridge-poc.component';
import { PostMessageBridgeTransport } from './transports/post-message.transport';

bootstrapApplication(IframeBridgePocComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: BRIDGE_TRANSPORT, useClass: PostMessageBridgeTransport },
  ],
}).catch((err: unknown) => {
  console.error('[BridgePoC] iframe bootstrap failed', err);
});