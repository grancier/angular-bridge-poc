import { provideZonelessChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { BRIDGE_TRANSPORT } from './bridge-transport';
import { CustomEventBridgePocComponent } from './bridge-poc.component';
import { CustomEventBridgeTransport } from './transports/custom-event.transport';

(async () => {
  const app = await createApplication({
    providers: [
      provideZonelessChangeDetection(),
      { provide: BRIDGE_TRANSPORT, useClass: CustomEventBridgeTransport },
    ],
  });

  const DsCanvasHostElement = createCustomElement(CustomEventBridgePocComponent, {
    injector: app.injector,
  });

  if (!customElements.get('ds-canvas-host')) {
    customElements.define('ds-canvas-host', DsCanvasHostElement);
  }
})();