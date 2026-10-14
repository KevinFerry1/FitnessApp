import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AccountShellComponent } from './app/account-shell.component';

bootstrapApplication(AccountShellComponent, appConfig)
  .catch((err) => console.error(err));
