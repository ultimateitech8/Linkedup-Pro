'use client';

import { useState, type FormEvent } from 'react';
import { Brand } from './components';
import { api, RequestError, type AccessOptions } from './data';

export type AuthLink = { kind: 'verify' | 'reset'; token: string | null; error: boolean };

export function takeAuthLink(): AuthLink | null {
  const url = new URL(window.location.href);
  const kind = url.searchParams.get('auth');
  if (kind !== 'verify' && kind !== 'reset') return null;
  const result: AuthLink = { kind, token: url.searchParams.get('token'), error: url.searchParams.has('error') };
  for (const name of ['auth', 'token', 'error']) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url);
  return result;
}

const screens = {
  signIn: { title: 'Welcome to Linkedup Pro', submit: 'Sign in' },
  signUp: { title: 'Create your account', submit: 'Create account' },
  forgot: { title: 'Reset your password', submit: 'Send reset link' },
  reset: { title: 'Choose a new password', submit: 'Update password' },
  verify: { title: 'Check your email', submit: 'Resend verification email' }
};
type Screen = keyof typeof screens;

function callback(kind: AuthLink['kind']) {
  return new URL(`/?auth=${kind}`, window.location.origin).href;
}

export function AuthScreen({ options, link, loginDemo, signedIn }: {
  options: AccessOptions; link: AuthLink | null;
  loginDemo: () => Promise<void>; signedIn: () => Promise<void>;
}) {
  const initialScreen = link?.kind === 'reset' ? link.token && !link.error ? 'reset' : 'forgot' :
    link?.kind === 'verify' && link.error ? 'verify' : 'signIn';
  const [mode, setMode] = useState<Screen>(initialScreen);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    link?.kind === 'verify' && !link.error ? 'Email verified. Sign in to continue.' : ''
  );
  const [error, setError] = useState(
    link && initialScreen !== 'reset' && (link.error || link.kind === 'reset')
      ? 'This link has expired or is invalid. Request a new email.' : ''
  );
  const screen = screens[mode];

  function change(next: Screen, message = '') {
    setError('');
    setStatus(message);
    setMode(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (mode === 'reset' && password !== form.get('confirmation')) {
      setError('The passwords do not match.');
      return;
    }
    const address = email.trim();
    let path: string;
    let fields: object;
    switch (mode) {
      case 'signUp':
        path = 'sign-up/email';
        fields = { email: address, name: String(form.get('name')).trim(), password, callbackURL: callback('verify') };
        break;
      case 'forgot':
        path = 'request-password-reset';
        fields = { email: address, redirectTo: callback('reset') };
        break;
      case 'reset':
        path = 'reset-password';
        fields = { token: link?.token, newPassword: password };
        break;
      case 'verify':
        path = 'send-verification-email';
        fields = { email: address, callbackURL: callback('verify') };
        break;
      default:
        path = 'sign-in/email';
        fields = { email: address, password };
    }

    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api(`auth/${path}`, { method: 'POST', body: JSON.stringify(fields) });
      if (mode === 'signUp' && options.emailEnabled) {
        change('verify', 'Check your inbox for a link to verify your email.');
      } else if (mode === 'verify') {
        setStatus('If your email still needs verification, you’ll receive a new link.');
      } else if (mode === 'forgot') {
        setStatus('If there’s an account for this email, you’ll receive a password reset link.');
      } else if (mode === 'reset') {
        change('signIn', 'Password updated. Sign in with your new password.');
      } else {
        await signedIn();
      }
    } catch (failure) {
      if (mode === 'signIn' && failure instanceof RequestError && failure.code === 'EMAIL_NOT_VERIFIED') {
        change('verify', 'Verify your email before signing in.');
      } else {
        setError((failure as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const needsPassword = mode === 'signUp' || mode === 'signIn' || mode === 'reset';
  return <main className="auth-page"><section className="card auth-card">
    <Brand /><h1>{screen.title}</h1>
    {mode === 'signUp' && options.inviteOnly && <p className="muted">Use the email address that received the beta invitation.</p>}
    <form className="field-form" onSubmit={submit} key={mode}>
      {mode === 'signUp' && <label>Full name<input name="name" autoComplete="name" required maxLength={100} /></label>}
      {mode !== 'reset' && <label>Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
      {needsPassword && <label>{mode === 'reset' ? 'New password' : 'Password'}
        {mode !== 'signIn' && <small>At least 12 characters</small>}
        <input name="password" type="password" minLength={mode === 'signIn' ? undefined : 12}
          maxLength={128} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} required />
      </label>}
      {mode === 'reset' && <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required maxLength={128} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {status && <p className="form-status" role="status">{status}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : screen.submit}</button>
    </form>
    {mode === 'signIn' ? <div className="auth-links">
      {options.emailEnabled && <button className="text-link" onClick={() => change('forgot')} disabled={busy}>Forgot password?</button>}
      <button className="text-link" onClick={() => change('signUp')} disabled={busy}>Create an account</button>
    </div> : <button className="text-link auth-switch" onClick={() => change('signIn')} disabled={busy}>Back to sign in</button>}
    {options.demoMode && mode === 'signIn' && <button className="button secondary full" onClick={() => void loginDemo()} disabled={busy}>Open demo workspace</button>}
  </section></main>;
}
