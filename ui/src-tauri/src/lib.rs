use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// Section 5 of the realignment spec: two modes, toggled without restart.
// config_mode=false (default) -> click-through, ambient overlay.
// config_mode=true -> window is interactive (drag/resize/chat).
#[derive(Default)]
struct OverlayState {
    config_mode: Mutex<bool>,
}

fn toggle_config_mode(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<OverlayState>();
    let mut config_mode = state.config_mode.lock().unwrap();
    *config_mode = !*config_mode;
    let click_through = !*config_mode;
    let _ = window.set_ignore_cursor_events(click_through);
    let _ = window.emit("overlay://config-mode", *config_mode);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut: tauri_plugin_global_shortcut::Shortcut =
        "ctrl+shift+a".parse().expect("invalid shortcut");
    let handler_shortcut = shortcut.clone();

    tauri::Builder::default()
        .manage(OverlayState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, triggered, event| {
                    if *triggered == handler_shortcut && event.state() == ShortcutState::Pressed {
                        toggle_config_mode(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.global_shortcut().register(shortcut.clone())?;

            // Starts click-through (config_mode=false), matching OverlayState's default.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_ignore_cursor_events(true);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
