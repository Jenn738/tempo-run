import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  n: number;
  title: string;
  active: boolean;
  done: boolean;
  summary?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}

/** One block of the flow. Active = expanded; done + inactive = one-line summary. */
export default function Step({ n, title, active, done, summary, onEdit, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (active && !first.current) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    first.current = false;
  }, [active]);

  if (!active) {
    return (
      <section ref={ref} className="step collapsed">
        <button className="step-row" onClick={onEdit} disabled={!onEdit}>
          <span className={`num ${done ? "done" : ""}`}>{done ? "✓" : n}</span>
          <span className="step-title">{title}</span>
          <span className="step-summary">{summary}</span>
          {onEdit && <span className="edit">Edit</span>}
        </button>
      </section>
    );
  }
  return (
    <section ref={ref} className="step open">
      <header className="step-head">
        <span className="num">{n}</span>
        <h2>{title}</h2>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}
