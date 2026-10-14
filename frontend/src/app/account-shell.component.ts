import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppComponent } from './app.component';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, AppComponent],
  template: `
    @if (!auth.ready()) {
      <main class="auth-page"><p>Opening Form…</p></main>
    } @else if (auth.user()) {
      <app-tracker />
    } @else {
      <main class="auth-page">
        <form class="auth-card" (ngSubmit)="submit()">
          <span class="auth-brand">FORM</span>
          <h1>{{ invite ? 'Your own space to train.' : 'Welcome back.' }}</h1>
          <p>{{ invite ? 'Create your account. Your food, weight, and workouts stay separate.' : 'Sign in to your personal tracker.' }}</p>
          <label>Username<input name="username" [(ngModel)]="username" autocomplete="username" autocapitalize="none" spellcheck="false" required [attr.minlength]="invite ? 3 : null" [attr.maxlength]="invite ? 40 : 150"></label>
          <label>Password<input name="password" [(ngModel)]="password" type="password" [autocomplete]="invite ? 'new-password' : 'current-password'" required maxlength="256"></label>
          @if (invite) {
            <label>Confirm password<input name="confirm" [(ngModel)]="confirm" type="password" autocomplete="new-password" required maxlength="256"></label>
            <small>Use at least 8 characters. Choose a password you don’t use elsewhere.</small>
          }
          @if (auth.error()) { <p class="auth-error" role="alert">{{ auth.error() }}</p> }
          <button class="primary" type="submit" [disabled]="auth.busy() || !username.trim() || !password">{{ auth.busy() ? 'Please wait…' : invite ? 'Create account' : 'Sign in' }}</button>
          @if (invite) { <button class="auth-link" type="button" (click)="existingAccount()">Already have an account? Sign in</button> }
          @else { <small>New here? Ask the person hosting Form for an invitation. For a forgotten password, ask them to reset it.</small> }
        </form>
      </main>
    }
  `,
  styles: [`
    .auth-page { min-height: 100dvh; display: grid; place-items: center; background: #f5f7f5; padding: max(28px, env(safe-area-inset-top)) 22px; color: #173f30; }
    .auth-card { width: min(100%, 390px); display: grid; gap: 20px; }
    .auth-brand { font-size: 14px; letter-spacing: .25em; font-weight: 800; }
    h1 { font-size: 36px; line-height: 1.15; margin: 0; letter-spacing: -.04em; }
    p { margin: 0; line-height: 1.6; } label { display: grid; gap: 8px; font-weight: 600; }
    input { border: 1px solid #c7d4cc; border-radius: 12px; padding: 15px; background: white; color: #173f30; font: inherit; font-size: 16px; width: 100%; box-sizing: border-box; }
    button { min-height: 48px; border: 0; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; }
    .primary { background: #173f30; color: white; } button:disabled { opacity: .55; } .auth-link { background: transparent; color: #173f30; }
    small { color: #607469; line-height: 1.5; } .auth-error { color: #a3332a; }
  `],
})
export class AccountShellComponent implements OnInit {
  username = '';
  password = '';
  confirm = '';
  invite = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';

  constructor(readonly auth: AuthService) {}
  ngOnInit(): void { void this.auth.restore(); }
  existingAccount(): void {
    this.invite = '';
    this.confirm = '';
    history.replaceState(null, '', location.pathname + location.search);
    this.auth.error.set('');
  }
  submit(): void {
    if (this.invite && this.password !== this.confirm) { this.auth.error.set('The passwords do not match.'); return; }
    void this.auth.submit(this.username.trim(), this.password, this.invite);
  }
}
