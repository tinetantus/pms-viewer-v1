'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function AuthForm({ invitation = false }: { invitation?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (invitation) {
        await api('invitations/accept', {
          token: location.hash.slice(1),
          name: form.get('name'),
          password: form.get('password'),
        });
        router.push('/login?accepted=1');
      } else {
        await api('auth/sign-in/email', {
          email: form.get('email'),
          password: form.get('password'),
        });
        router.push('/');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="brand">
          <span className="brand-mark">P</span> proofroom<span className="brand-tag">PMS / 01</span>
        </div>
        <div>
          <p className="eyebrow">EVERY DETAIL. EVERY REVISION.</p>
          <h1>
            A clearer path
            <br />
            to the final proof.
          </h1>
          <p>Review artwork together. Keep every correction in context. Approve with confidence.</p>
        </div>
        <small>PACKAGING REVIEW WORKSPACE · 4CARE</small>
      </div>
      <main className="auth-main">
        <form onSubmit={submit} className="auth-card">
          <p className="eyebrow">YOUR REVIEW WORKSPACE</p>
          <h2>{invitation ? 'Accept your invitation' : 'Welcome back'}</h2>
          <p className="muted">
            {invitation
              ? 'Choose your name and a secure password.'
              : 'Sign in to continue reviewing packaging artwork.'}
          </p>
          {invitation ? (
            <label>
              Your name
              <input name="name" required autoComplete="name" />
            </label>
          ) : (
            <label>
              Email address
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={invitation ? 12 : 1}
              required
              autoComplete={invitation ? 'new-password' : 'current-password'}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : invitation ? 'Create account' : 'Sign in'} <span>↗</span>
          </button>
          <p className="fine">
            Invite-only access. Contact your workspace administrator if you need an account.
          </p>
        </form>
      </main>
    </div>
  );
}
