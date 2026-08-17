import { useEffect, useRef, useState } from "react";
import { isTauri } from "./tauriEnv";
import { loadOverlaySettings, saveOverlaySettings } from "./OverlaySettingsStore";

export interface MonitorInfo {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * The only place this app touches Tauri's window APIs. Everything is a
 * no-op when not running inside Tauri (e.g. the plain Vite dev server in a
 * browser tab), so App.tsx can keep rendering the full chat UI there for
 * quick iteration/testing, per the project's browser-verification workflow.
 */
export function useOverlay() {
  const available = isTauri();
  const [configMode, setConfigMode] = useState(false);
  const [alwaysOnTop, setAlwaysOnTopState] = useState(true);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const windowRef = useRef<import("@tauri-apps/api/window").Window | null>(null);

  useEffect(() => {
    if (!available) return;

    let unlistenConfig: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      windowRef.current = win;

      // Listening for the Rust-emitted toggle must not depend on anything
      // below succeeding - a permission/DPI-API failure in the
      // position/monitor restore logic previously prevented this from ever
      // being registered, which silently broke Ctrl+Shift+A end-to-end.
      try {
        unlistenConfig = await win.listen<boolean>("overlay://config-mode", (e) => {
          setConfigMode(e.payload);
        });
      } catch (err) {
        console.error("[overlay] failed to listen for overlay://config-mode", err);
      }

      try {
        const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
        const saved = loadOverlaySettings();
        if (saved.x !== undefined && saved.y !== undefined) {
          await win.setPosition(new PhysicalPosition(saved.x, saved.y));
        }
        if (saved.width !== undefined && saved.height !== undefined) {
          await win.setSize(new PhysicalSize(saved.width, saved.height));
        }
        const savedAlwaysOnTop = saved.alwaysOnTop ?? true;
        if (!cancelled) setAlwaysOnTopState(savedAlwaysOnTop);
        await win.setAlwaysOnTop(savedAlwaysOnTop);
      } catch (err) {
        console.error("[overlay] failed to restore persisted window settings", err);
      }

      try {
        const { availableMonitors } = await import("@tauri-apps/api/window");
        const mons = await availableMonitors();
        if (!cancelled) {
          setMonitors(
            mons.map((m) => ({
              name: m.name,
              position: { x: m.position.x, y: m.position.y },
              size: { width: m.size.width, height: m.size.height },
            })),
          );
        }
      } catch (err) {
        console.error("[overlay] failed to enumerate monitors", err);
      }

      try {
        unlistenMove = await win.onMoved(({ payload }) => {
          saveOverlaySettings({ x: payload.x, y: payload.y });
        });
        unlistenResize = await win.onResized(({ payload }) => {
          saveOverlaySettings({ width: payload.width, height: payload.height });
        });
      } catch (err) {
        console.error("[overlay] failed to subscribe to move/resize", err);
      }
    })();

    return () => {
      cancelled = true;
      unlistenConfig?.();
      unlistenMove?.();
      unlistenResize?.();
    };
  }, [available]);

  const startDragging = async () => {
    await windowRef.current?.startDragging();
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTopState(next);
    saveOverlaySettings({ alwaysOnTop: next });
    await windowRef.current?.setAlwaysOnTop(next);
  };

  const moveToMonitor = async (monitor: MonitorInfo) => {
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    await windowRef.current?.setPosition(new PhysicalPosition(monitor.position.x + 120, monitor.position.y + 120));
  };

  return { available, configMode, alwaysOnTop, monitors, startDragging, toggleAlwaysOnTop, moveToMonitor };
}

export type OverlayApi = ReturnType<typeof useOverlay>;
