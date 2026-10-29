import { Link } from "react-router-dom";
import { useTheme } from "../lib/hooks";

/** The mark: a K that always stands above the floor line. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <rect width="24" height="24" rx="6.5" fill="var(--accent)" />
      <g fill="none" stroke="var(--on-accent)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.6 5.6v9.2M15.6 5.6l-5 4.6 5 4.6" />
      </g>
      <path d="M5.6 18.6h12.8" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="Keel home">
      <Mark />
      <span>Keel</span>
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
