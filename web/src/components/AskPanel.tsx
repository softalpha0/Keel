import { useEffect, useRef, useState } from "react";
import { askKeel, type AskAnswer, type AskContext } from "../lib/ask";

type Message = { role: "you" } & { text: string } | ({ role: "keel" } & AskAnswer);

export function SparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" />
      <path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" opacity="0.6" />
    </svg>
  );
}

/** Slide-over chat: ask Claude why the agent did what it did, grounded in the run on screen. */
export function AskPanel({ open, onClose, context, suggestions }: { open: boolean; onClose: () => void; context: AskContext | null; suggestions: string[] }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }), [messages.length, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !context) return;
    setDraft("");
    setMessages((m) => [...m, { role: "you", text: q }]);
    setBusy(true);
    const a = await askKeel(q, context);
    setMessages((m) => [...m, { role: "keel", ...a }]);
    setBusy(false);
  };

  return (
    <>
      <div className={`ask-scrim${open ? " is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`ask${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-label="Ask Keel" aria-hidden={!open}>
        <header className="ask-head">
          <div className="ask-title">
            <span className="ask-badge">
              <SparkIcon />
            </span>
            <div>
              <strong>Ask Keel</strong>
              <div className="muted ask-sub">Claude answers from this run's decision log</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="ask-body" ref={list}>
          {messages.length === 0 && (
            <div className="ask-empty">
              <p className="secondary">Ask why the agent did something. Try one of these:</p>
              <div className="ask-chips">
                {suggestions.map((s) => (
                  <button key={s} className="ask-chip" onClick={() => void ask(s)} disabled={!context}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "you" ? (
              <div key={i} className="msg msg-you">
                {m.text}
              </div>
            ) : (
              <div key={i} className="msg msg-keel">
                <p>{m.answer}</p>
                <span className={`msg-by${m.by === "claude" ? " is-claude" : ""}`}>{m.by === "claude" ? "Claude" : "From the decision log"}</span>
              </div>
            ),
          )}
          {busy && (
            <div className="msg msg-keel msg-busy" aria-live="polite">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}
        </div>

        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <textarea
            ref={input}
            value={draft}
            maxLength={500}
            rows={2}
            placeholder={context ? "Why did you decline Nimbus in week 8?" : "Run a few weeks first"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button className="btn btn-primary btn-sm" disabled={!draft.trim() || busy || !context}>
            Ask
          </button>
        </form>
      </aside>
    </>
  );
}
