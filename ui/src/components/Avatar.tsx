import "./Avatar.css";
import type { Expression } from "../presentation/types";

export interface AvatarProps {
  expression: Expression;
  mouthOpenness: number;
  blinking: boolean;
}

// Section 21 - the renderer only ever receives { Expression, Motion,
// SpeechState, LipSync } (approximated here as expression/mouthOpenness/
// blinking) and draws. No Live2D model file exists for this project, so
// this is a procedural SVG "face" instead - same contract, no assets.
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

const EYEBROWS: Record<Expression, { left: number; right: number; dy: number }> = {
  idle: { left: 0, right: 0, dy: 0 },
  listening: { left: -8, right: 8, dy: -2 },
  thinking: { left: -18, right: 6, dy: -3 },
  focused: { left: 12, right: -12, dy: 3 },
  speaking: { left: 0, right: 0, dy: -1 },
  waiting: { left: -14, right: 14, dy: -5 },
  success: { left: -6, right: -6, dy: -2 },
  error: { left: 16, right: -16, dy: 5 },
  surprised: { left: -20, right: 20, dy: -8 },
};

// Quadratic-bezier control-point Y offset for the mouth curve: positive
// dips the middle down (a "cup" - smile), negative arcs it up (a "cap" -
// frown). Ignored for "surprised" (rendered as an open "o") and "speaking"
// (rendered as the amplitude-driven ellipse instead).
const MOUTH_CURVE: Record<Expression, number> = {
  idle: 4,
  listening: 6,
  thinking: 0,
  focused: 0,
  speaking: 0,
  waiting: 2,
  success: 14,
  error: -14,
  surprised: 0,
};

function eyebrowLine(cx: number, cy: number, angleDeg: number, dy: number, mirror: 1 | -1) {
  const halfWidth = 16;
  const x1 = cx - halfWidth * mirror;
  const x2 = cx + halfWidth * mirror;
  return (
    <line
      x1={x1}
      y1={cy}
      x2={x2}
      y2={cy}
      stroke="#e2e8f0"
      strokeWidth={5}
      strokeLinecap="round"
      transform={`rotate(${angleDeg * mirror}, ${cx}, ${cy}) translate(0, ${dy})`}
    />
  );
}

export function Avatar({ expression, mouthOpenness, blinking }: AvatarProps) {
  const color = EXPRESSION_COLOR[expression];
  const brows = EYEBROWS[expression];
  const eyeRy = blinking ? 1.5 : 12;

  const mouthCx = 100;
  const mouthY = 148;
  const mouthHalfWidth = 18;
  const curve = MOUTH_CURVE[expression];

  return (
    <div className={`avatar avatar--${expression}`} role="img" aria-label={`aymi - ${expression}`}>
      <svg viewBox="0 0 200 220" width="260" height="286">
        <circle cx="100" cy="108" r="92" fill="none" stroke={color} strokeWidth="4" className="avatar-aura" />
        <circle cx="100" cy="112" r="72" fill="#1e293b" />

        {eyebrowLine(75, 82, brows.left, brows.dy, 1)}
        {eyebrowLine(125, 82, brows.right, brows.dy, -1)}

        <ellipse cx="75" cy="104" rx="10" ry={eyeRy} fill="#e2e8f0" />
        <ellipse cx="125" cy="104" rx="10" ry={eyeRy} fill="#e2e8f0" />

        {expression === "surprised" ? (
          <ellipse cx={mouthCx} cy={mouthY} rx={12} ry={16} fill="#0f172a" stroke={color} strokeWidth={2} />
        ) : expression === "speaking" ? (
          <ellipse
            cx={mouthCx}
            cy={mouthY}
            rx={mouthHalfWidth}
            ry={4 + mouthOpenness * 18}
            fill="#0f172a"
            stroke={color}
            strokeWidth={2}
          />
        ) : (
          <path
            d={`M ${mouthCx - mouthHalfWidth} ${mouthY} Q ${mouthCx} ${mouthY + curve} ${mouthCx + mouthHalfWidth} ${mouthY}`}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}
