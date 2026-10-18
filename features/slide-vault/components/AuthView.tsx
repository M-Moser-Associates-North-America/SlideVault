'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from './icons';
import { useWorkspace } from './state';

/**
 * Local design prototype: a fake sign-in, pulled from the client's own reference mockup
 * (reference/SlideVault.html -- its login card doesn't check a password either, `doSignIn` there
 * just flips a flag). Not real auth. M Moser owns the real identity system; this only
 * demonstrates having a gate. Clicking Sign in, with or without anything typed, signs in as the
 * one demo profile ("Person A").
 */
export function LoginView() {
  const { submitLogin } = useWorkspace();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    submitLogin();
  };

  return (
    <div className="auth-screen">
      <div className="auth-col">
        <div className="auth-brand">
          <Icon name="logoFill" className="ic" />
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
          <div className="auth-sim" role="note">
            <p className="auth-sim-title">SIMULATED</p>
            <p className="auth-sim-note">This sign-in is simulated.
              <br />
              Just click on Sign in below.</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
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
