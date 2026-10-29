import { Link } from "react-router-dom";
import { ThemeToggle, Wordmark } from "../components/Brand";

export function NotFound() {
  return (
    <div className="console">
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <div className="topbar-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="run-main">
        <section className="card run-empty">
          <p className="eyebrow">404</p>
          <h1 className="dialog-title">This page isn't on the books.</h1>
          <p className="secondary">The link may be old, or mistyped. Everything Keel does is one of these three pages.</p>
          <div className="hero-ctas">
            <Link to="/" className="btn btn-primary btn-sm">
              Overview
            </Link>
            <Link to="/desk" className="btn btn-sm">
              Credit desk
            </Link>
            <Link to="/run" className="btn btn-sm">
              Sandbox run
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
