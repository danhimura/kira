import "./Avatar.css";
import type { CSSProperties } from "react";
import type { Expression } from "../presentation/types";
import exprNeutral from "../assets/expr-neutral.png";
import exprAtenta from "../assets/expr-atenta.png";
import exprPensando from "../assets/expr-pensando.png";
import exprConfidente from "../assets/expr-confidente.png";
import exprConcernida from "../assets/expr-concernida.png";
import exprAnimada from "../assets/expr-animada.png";
import exprErro from "../assets/expr-erro.png";
import exprSurpresa from "../assets/expr-surpresa.png";
import exprFalandoA from "../assets/expr-falando-a.png";
import exprFalandoE from "../assets/expr-falando-e.png";
import exprFalandoO from "../assets/expr-falando-o.png";
import exprFalandoM from "../assets/expr-falando-m.png";
import exprPiscando from "../assets/expr-piscando.png";

export interface AvatarProps {
  expression: Expression;
  mouthOpenness: number;
  blinking: boolean;
}

const EXPRESSION_COLOR: Record<Expression, string> = {
  idle: "#64748b",
  listening: "#06b6d4",
  thinking: "#8b5cf6",
  focused: "#3b82f6",
  speaking: "#22c55e",
  waiting: "#f59e0b",
  success: "#10b981",
  error: "#ef4444",
  surprised: "#eab308",
};

// Non-speaking states each get a fixed pose sliced from the character's
// expression sheet (ui/src/assets/Expressoes.png). "speaking" is handled
// separately below since its pose cycles with mouthOpenness instead.
const EXPRESSION_IMAGE: Record<Exclude<Expression, "speaking">, string> = {
  idle: exprNeutral,
  listening: exprAtenta,
  thinking: exprPensando,
  focused: exprConfidente,
  waiting: exprConcernida,
  success: exprAnimada,
  error: exprErro,
  surprised: exprSurpresa,
};

// Crude viseme cycling from a single amplitude value (no phoneme timing
// available from the TTS pipeline yet - see AGENTS/README's lip sync note).
function speakingFrame(mouthOpenness: number): string {
  if (mouthOpenness < 0.15) return exprFalandoM;
  if (mouthOpenness < 0.4) return exprFalandoE;
  if (mouthOpenness < 0.65) return exprFalandoO;
  return exprFalandoA;
}

export function Avatar({ expression, mouthOpenness, blinking }: AvatarProps) {
  const color = EXPRESSION_COLOR[expression];
  const image = blinking
    ? exprPiscando
    : expression === "speaking"
      ? speakingFrame(mouthOpenness)
      : EXPRESSION_IMAGE[expression];

  return (
    <div
      className={`avatar avatar--${expression}`}
      role="img"
      aria-label={`aymi - ${expression}`}
      style={{ "--aura-color": color } as CSSProperties}
    >
      <div className="avatar-aura" />
      <img src={image} alt="" className="avatar-image" />
    </div>
  );
}
