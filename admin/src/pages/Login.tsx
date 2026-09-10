import React, { useState } from 'react';
import { api } from '../api';

// v0.26.3 trust model (D11 + D12):
// - The bootstrap token is NEVER stored in browser JS state. No
// localStorage, no sessionStorage, no React state beyond the form
// submit cycle. After successful POST /admin/login the operator's
// token only lives in the HttpOnly cookie that the server set.
// - Magic-link URLs use single-use server-issued nonces, not the
// bootstrap token itself (see /admin/api/issue-magic-link). The
// bootstrap token never appears in a URL.
// - Closing the tab ends the session client-side. Reopening the
// dashboard 401s and shows this page again. Operator asks the agent
// for a fresh magic link or pastes the bootstrap token from the
// server's terminal scrollback.
//
// v0.42+ UX pass: this screen doubles as the first thing anyone sees
// (operator or a new teammate) when they open the dashboard, so it's
// framed as a welcome/landing state rather than an access-denied
// warning. Same trust model, calmer presentation, and the bootstrap
// token field now has a real <label> instead of relying on
// placeholder text alone (screen readers drop placeholder text once
// the field has a value).
export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(token);
      // Don't persist the token. The HttpOnly cookie is the only
      // session credential after this point.
      setToken('');
      onLogin();
    } catch (err) {
      setError('Invalid token.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">GBrain</div>
        <div className="login-tagline">Sign in to manage agents, keys, and requests.</div>

        <div className="login-welcome">
          <div className="login-welcome-title">
            <span aria-hidden="true">🔒</span> Ask your AI agent to sign you in
          </div>
          <div className="login-welcome-body">Say this to your agent:</div>
          <div className="login-welcome-prompt">"Give me the GBrain admin login link"</div>
          <div className="login-hint" style={{ marginTop: 8 }}>
            Each link is single-use. Your agent generates a fresh one each time.
          </div>
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
            Or paste bootstrap token manually
          </summary>
          <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="bootstrap-token">Admin token</label>
              <input
                id="bootstrap-token"
                type="password"
                placeholder="Paste token"
                autoComplete="off"
                value={token}
                onChange={e => setToken(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Authenticating...' : 'Submit'}
            </button>
            {error && <div className="login-error" role="alert">{error}</div>}
          </form>
        </details>
      </div>
    </div>
  );
}
