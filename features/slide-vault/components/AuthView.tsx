'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from './icons';
import { DEMO_PROFILES, profileInitials, useWorkspace } from './state';

/**
 * Local design prototype: a fake sign-in, pulled pixel-for-pixel from the client's own reference
 * mockup (reference/SlideVault.html -- its login card doesn't check a password either, `doSignIn`
 * there just flips a flag). Not real auth, not pushed, not touching Khushali's build. M Moser owns
 * the real identity system; this only needs to demonstrate having a gate, for the pitch.
 *
 * One hardcoded demo credential (not a security boundary, just something to type in a demo):
 * 1234@you.com / duh
 */
const DEMO_EMAIL = '1234@you.com';
const DEMO_PASSWORD = 'duh';

export function LoginView() {
  const { submitLogin } = useWorkspace();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Not a real security boundary (see above) -- case/whitespace-insensitive so a phone
    // keyboard's autocapitalize doesn't turn a correct demo credential into a rejected one.
    if (isSignUp || (email.trim().toLowerCase() === DEMO_EMAIL && password.trim().toLowerCase() === DEMO_PASSWORD)) {
      setError(false);
      submitLogin();
    } else {
      setError(true);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-col">
        <div className="auth-brand">
          <Icon name="library" className="ic" />
          <span className="auth-wordmark">SLIDEVAULT</span>
        </div>
        <div className="auth-card">
          <div className="auth-head">
            <p className="auth-eyebrow">Proposal library</p>
            <h1 className="auth-title" tabIndex={-1}>
              {isSignUp ? 'Request access' : 'Welcome back'}
            </h1>
            <p className="auth-sub">{isSignUp ? "We'll set you up with a SlideVault seat." : 'Sign in to search and assemble proposals.'}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            {error && (
              <div className="notice danger" role="alert">
                <Icon name="alert" />
                <span>That email and password don&rsquo;t match. Try again.</span>
              </div>
            )}
            <label className="auth-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@mmoser.com"
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <div className="auth-pw">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="current-password"
                  required
                />
                <button type="button" className="auth-pw-toggle" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)}>
                  <Icon name={showPw ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </label>
            <button type="submit" className="btn btn-primary auth-submit">
              {isSignUp ? 'Request access' : 'Sign in'}
            </button>
          </form>
          <div className="auth-switch">
            {isSignUp ? 'Already have access?' : 'Need an account?'}{' '}
            <button type="button" className="auth-switch-cta" onClick={() => setIsSignUp((v) => !v)}>
              {isSignUp ? 'Sign in' : 'Request access'}
            </button>
          </div>
        </div>
        <div className="auth-foot">
          <span>Legal</span>
          <span>Security</span>
          <span>Support</span>
        </div>
      </div>
    </div>
  );
}

/** The "who's this" step after a fake sign-in -- same shape as Netflix's profile picker, with demo names in place of real accounts (docs/DECISIONS.md: no real identity system yet). */
export function PickProfileView() {
  const { pickProfile } = useWorkspace();
  return (
    <div className="auth-screen">
      <div className="auth-col auth-col-wide">
        <div className="auth-brand">
          <Icon name="library" className="ic" />
          <span className="auth-wordmark">SLIDEVAULT</span>
        </div>
        <h1 className="auth-pick-h" tabIndex={-1}>
          Who&rsquo;s this for?
        </h1>
        <p className="auth-sub">Pick a profile to see a feed personalized to them.</p>
        <ul className="auth-pick-grid">
          {DEMO_PROFILES.map((name) => (
            <li key={name}>
              <button type="button" className="auth-pick-tile" onClick={() => pickProfile(name)}>
                <span className="auth-pick-avatar" aria-hidden="true">
                  {profileInitials(name)}
                </span>
                <span className="auth-pick-name">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
