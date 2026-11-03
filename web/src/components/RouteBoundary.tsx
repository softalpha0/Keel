import { Component, type ReactNode } from "react";

const RETRY_KEY = "keel-route-retry";

/** Reload the page once per path; returns false if we already tried, so callers can show the error instead. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RETRY_KEY) === location.pathname) return false;
    sessionStorage.setItem(RETRY_KEY, location.pathname);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/**
 * Keeps a page crash from leaving a blank screen. Browser extensions that edit the page
 * (translators, wallets, grammar checkers) can break React's DOM updates on navigation;
 * a fresh load fixes that, so we reload once automatically and otherwise show the error.
 */
export class RouteBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Keel page error:", error);
    reloadOnce();
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // Moving to another page gives it a clean start.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidMount() {
    // A page that renders cleanly clears the one-reload guard.
    setTimeout(() => {
      try {
        sessionStorage.removeItem(RETRY_KEY);
      } catch {
        // ignore
      }
    }, 3000);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error">
        <div className="card">
          <strong>This page didn't load properly.</strong>
          <p className="secondary">A browser extension may have changed the page. Reloading usually fixes it.</p>
          <code className="muted">{this.state.error.message}</code>
          <button className="btn btn-primary btn-sm" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
