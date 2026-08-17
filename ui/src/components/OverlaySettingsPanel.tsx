import "./OverlaySettingsPanel.css";
import type { OverlayApi } from "../overlay/useOverlay";

export interface OverlaySettingsPanelProps {
  overlay: OverlayApi;
}

// Only shown while overlay.configMode is true (Ctrl+Shift+A toggles it) -
// the click-through/ambient state hides this entirely, per item 5 of the
// realignment spec.
export function OverlaySettingsPanel({ overlay }: OverlaySettingsPanelProps) {
  return (
    <div className="overlay-settings">
      <label className="overlay-settings-row">
        <input type="checkbox" checked={overlay.alwaysOnTop} onChange={() => overlay.toggleAlwaysOnTop()} />
        Sempre no topo
      </label>

      {overlay.monitors.length > 1 && (
        <div className="overlay-settings-row overlay-settings-monitors">
          Mover para:
          {overlay.monitors.map((m, i) => (
            <button key={i} onClick={() => overlay.moveToMonitor(m)}>
              Monitor {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="overlay-settings-hint">Ctrl+Shift+A alterna modo overlay / configuração</div>
    </div>
  );
}
