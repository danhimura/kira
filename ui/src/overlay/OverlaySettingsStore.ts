export interface OverlaySettings {
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
}

const KEY = "aymi.overlay.settings.v1";

export function loadOverlaySettings(): Partial<OverlaySettings> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveOverlaySettings(patch: Partial<OverlaySettings>): void {
  try {
    const current = loadOverlaySettings();
    localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // best-effort persistence; a full disk or disabled storage shouldn't crash the overlay
  }
}
