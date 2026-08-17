import "./StatusPanel.css";
import type { ChatMessage, PendingConfirmation, ToolActivity } from "../ws/useAymiAgent";
import type { PresentationState } from "../presentation/types";

export interface StatusPanelProps {
  connected: boolean;
  presentationState: PresentationState;
  messages: ChatMessage[];
  toolActivity?: ToolActivity;
  pendingConfirmation?: PendingConfirmation;
  errorMessage?: string;
  onConfirm: (approved: boolean) => void;
}

// Section 36's mockup: state + last message + tool activity, without
// exposing the model's private reasoning - just what happened.
export function StatusPanel({
  connected,
  presentationState,
  messages,
  toolActivity,
  pendingConfirmation,
  errorMessage,
  onConfirm,
}: StatusPanelProps) {
  return (
    <div className="status-panel">
      <div className="status-row">
        <span className={`status-dot ${connected ? "status-dot--on" : "status-dot--off"}`} />
        <span className="status-label">Estado: {presentationState}</span>
      </div>

      {toolActivity && (
        <div className="status-row status-row--tool">
          Tool: {toolActivity.tool} — Status: {toolActivity.status.toUpperCase()}
        </div>
      )}

      {errorMessage && <div className="status-row status-row--error">Erro: {errorMessage}</div>}

      {pendingConfirmation && (
        <div className="confirmation-box">
          <p>
            Confirmar execução de <strong>{pendingConfirmation.tool}</strong>?
          </p>
          <p className="confirmation-reason">{pendingConfirmation.reason}</p>
          <div className="confirmation-actions">
            <button onClick={() => onConfirm(true)}>Sim</button>
            <button onClick={() => onConfirm(false)}>Não</button>
          </div>
        </div>
      )}

      <div className="message-log">
        {messages.map((m, i) => (
          <div key={i} className={`message message--${m.role}`}>
            <span className="message-role">{m.role === "user" ? "Você" : "aymi"}</span>
            <span className="message-content">{m.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
