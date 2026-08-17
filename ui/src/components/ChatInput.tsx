import { useState, type FormEvent } from "react";
import "./ChatInput.css";

export interface ChatInputProps {
  processing: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function ChatInput({ processing, onSend, onCancel }: ChatInputProps) {
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || processing) return;
    onSend(value);
    setValue("");
  };

  return (
    <form className="chat-input" onSubmit={submit}>
      <span className="chat-input-icon">🎙</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Digite sua mensagem..."
        disabled={processing}
      />
      {processing ? (
        <button type="button" onClick={onCancel} className="chat-input-cancel">
          Cancelar
        </button>
      ) : (
        <button type="submit" disabled={!value.trim()}>
          Enviar
        </button>
      )}
    </form>
  );
}
