import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideHttpClient, withXhr, withXsrfConfiguration, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { accountInterceptor } from './auth.service';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes), provideHttpClient(withXhr(), withXsrfConfiguration({ cookieName: 'csrftoken', headerName: 'X-CSRFToken' }), withInterceptors([accountInterceptor])), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerImmediately'
          })]
};
