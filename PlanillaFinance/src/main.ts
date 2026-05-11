console.log(
  '%c¡SISTEMA MONITOREADO!',
  'color: #d32f2f; font-size: 50px; font-weight: bold; text-shadow: 3px 3px 0 rgba(0,0,0,0.1); font-family: system-ui;'
);
console.log(
  '%cEste sistema se encuentra bajo monitoreo activo de seguridad. El acceso no autorizado a las herramientas de desarrollo y la manipulación de datos están estrictamente prohibidos y son registrados.',
  'font-size: 18px; color: #333; line-height: 1.4; font-family: system-ui;'
);
console.log(
  '%cGestor Finance v2.0 - Seguridad y Auditoría',
  'font-size: 14px; color: #666; font-style: italic; font-family: system-ui; margin-top: 10px;'
);

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
