import { useState } from "react";
import { api } from "../api";

/** Shown when Spotify refuses an account that isn't on the app's allowlist. */
export default function RequestAccess({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S{2,}$/.test(email.trim())) {
      setError("Enter the email you use for Spotify.");
      return;
    }
    setState("sending");
    setError(null);
    try {
      await api.requestAccess(email.trim(), name.trim());
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent") {
    return <p className="login-ok">Request sent. Once you've been added, connect again.</p>;
  }

  return (
    <div className="request">
      <p className="login-error">
        This Spotify account isn't on Tempo Run's list yet.{" "}
        {enabled ? (
          <>
            <button className="inline-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              Click here
            </button>{" "}
            to ask the owner to add your Spotify email, then connect again.
          </>
        ) : (
          "Ask the owner to add your Spotify email, then connect again."
        )}
      </p>
      {open && enabled && (
        <form className="request-form" onSubmit={send}>
          <input
            type="email"
            placeholder="your Spotify email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            autoFocus
            required
          />
          <input placeholder="your name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button className="secondary small" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send request"}
          </button>
          {error && <p className="login-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
