import { useEffect, useRef, useState } from "react";
import { PresentationStateMachine } from "../presentation/PresentationStateMachine";
import { AnimationController, type AnimationSnapshot } from "../presentation/AnimationController";
import type { AgentEvent, PresentationState } from "../presentation/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolActivity {
  tool: string;
  status: "started" | "completed" | "failed" | "timeout";
}

export interface PendingConfirmation {
  tool: string;
  reason: string;
}

const WS_URL = `ws://${window.location.hostname}:8787/ws`;

// Section 16 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md - the voice
// pipeline's own state machine is independent of the agent's, but both
// drive the same avatar. Whichever fires last wins; once a command is
// forwarded, agent.state.changed events follow almost immediately and
// naturally take over.
const VOICE_TO_PRESENTATION: Record<string, PresentationState> = {
  VOICE_IDLE: "IDLE",
  LISTENING_FOR_WAKE: "LISTENING",
  WAKE_DETECTED: "LISTENING",
  CAPTURING_COMMAND: "LISTENING",
  TRANSCRIBING: "THINKING",
  COMMAND_READY: "THINKING",
  FORWARDING: "FOCUSED",
  AUDIO_ERROR: "ERROR",
  TIMEOUT: "IDLE",
};

/**
 * The only place this frontend talks to the backend. Everything else
 * (Avatar, StatusPanel, ChatInput) just renders whatever this hook exposes -
 * it never touches the WebSocket or the Agent Runtime's event shapes
 * directly, matching section 21's "the renderer doesn't know the agent's
 * logic."
 */
export function useAymiAgent() {
  const psmRef = useRef<PresentationStateMachine | null>(null);
  const animRef = useRef<AnimationController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  if (!psmRef.current) psmRef.current = new PresentationStateMachine();
  if (!animRef.current) animRef.current = new AnimationController();

  const [connected, setConnected] = useState(false);
  const [presentationState, setPresentationState] = useState<PresentationState>("IDLE");
  const [animation, setAnimation] = useState<AnimationSnapshot>({ expression: "idle", mouthOpenness: 0, blinking: false });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolActivity, setToolActivity] = useState<ToolActivity | undefined>();
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [processing, setProcessing] = useState(false);
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    const psm = psmRef.current!;
    const anim = animRef.current!;
    const unsubPsm = psm.subscribe(setPresentationState);
    const unsubAnim = anim.subscribe(setAnimation);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (raw) => {
      const msg = JSON.parse(raw.data as string);

      if (msg.type === "hello") {
        setTools(msg.tools ?? []);
        return;
      }

      if (msg.type === "response") {
        setMessages((history) => [...history, { role: "assistant", content: msg.text }]);
        setProcessing(false);
        return;
      }

      if (msg.type === "error") {
        setErrorMessage(msg.message);
        setProcessing(false);
        return;
      }

      if (msg.type !== "event") return;
      const event: AgentEvent = msg.event;

      switch (event.name) {
        case "agent.state.changed": {
          const { to } = event.data as { to: string };
          psm.onAgentStateChanged(to);
          anim.setBaseState(psm.current);
          break;
        }
        case "tool.started":
          setToolActivity({ tool: (event.data as { tool: string }).tool, status: "started" });
          break;
        case "tool.completed":
          setToolActivity({ tool: (event.data as { tool: string }).tool, status: "completed" });
          break;
        case "tool.failed":
          setToolActivity({ tool: (event.data as { tool: string }).tool, status: "failed" });
          break;
        case "tool.timeout":
          setToolActivity({ tool: (event.data as { tool: string }).tool, status: "timeout" });
          break;
        case "confirmation.requested": {
          const d = event.data as { tool: string; reason: string };
          anim.setConfirmationPending(true);
          setPendingConfirmation({ tool: d.tool, reason: d.reason });
          break;
        }
        case "confirmation.accepted":
        case "confirmation.denied":
          anim.setConfirmationPending(false);
          setPendingConfirmation(undefined);
          break;
        case "speech.started":
          anim.setSpeaking(true);
          break;
        case "speech.chunk": {
          const amplitude = (event.data as { amplitude?: number }).amplitude;
          if (typeof amplitude === "number") anim.setMouthAmplitude(amplitude);
          break;
        }
        case "speech.finished":
        case "speech.interrupted":
          anim.setSpeaking(false);
          break;
        case "voice.state.changed": {
          const { state } = event.data as { state: string };
          const mapped = VOICE_TO_PRESENTATION[state];
          if (mapped) anim.setBaseState(mapped);
          break;
        }
        default:
          break;
      }
    };

    return () => {
      unsubPsm();
      unsubAnim();
      anim.dispose();
      ws.close();
    };
  }, []);

  const sendInput = (text: string) => {
    if (!text.trim() || !wsRef.current) return;
    setMessages((history) => [...history, { role: "user", content: text }]);
    setToolActivity(undefined);
    setErrorMessage(undefined);
    setProcessing(true);
    wsRef.current.send(JSON.stringify({ type: "input", text }));
  };

  const sendConfirm = (approved: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: "confirm", approved }));
  };

  const sendCancel = () => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
  };

  return {
    connected,
    presentationState,
    animation,
    messages,
    toolActivity,
    pendingConfirmation,
    errorMessage,
    processing,
    tools,
    sendInput,
    sendConfirm,
    sendCancel,
  };
}
