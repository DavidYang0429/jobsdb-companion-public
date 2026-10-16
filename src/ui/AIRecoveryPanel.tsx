import { useEffect, useRef } from "react";
import {
  aiActionLabels,
  type AIRecovery,
  type AIRecoveryAction,
} from "../services/aiErrors";
export function AIRecoveryPanel({
  recovery,
  allowManual,
  busy,
  onAction,
}: {
  recovery: AIRecovery;
  allowManual: boolean;
  busy: boolean;
  onAction: (action: AIRecoveryAction) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [recovery]);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="ai-recovery notice"
      role={recovery.code === "cancelled" ? "status" : "alert"}
      aria-labelledby="ai-recovery-title"
    >
      <h3 id="ai-recovery-title">{recovery.title}</h3>
      <p>{recovery.explanation}</p>
      <ol>
        {recovery.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="actions">
        {recovery.actions
          .filter((action) => allowManual || action !== "manual")
          .map((action) => (
            <button
              key={action}
              disabled={busy}
              className={action === recovery.actions[0] ? "primary" : undefined}
              onClick={() => onAction(action)}
            >
              {aiActionLabels[action]}
            </button>
          ))}
      </div>
    </section>
  );
}
