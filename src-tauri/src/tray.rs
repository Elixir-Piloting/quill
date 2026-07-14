use std::sync::{atomic::Ordering, Arc};

use tauri::{
    menu::MenuItemBuilder,
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::state::AppState;

pub fn setup_tray(app: &AppHandle, state: Arc<AppState>) -> tauri::Result<()> {
    let open = tauri::menu::MenuItemBuilder::with_id("open_settings", "Open Settings").build(app)?;
    let initial_label = if state.paused.load(Ordering::SeqCst) { "Resume" } else { "Pause" };
    let toggle = MenuItemBuilder::with_id("toggle_pause", initial_label).build(app)?;
    let quit = tauri::menu::MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = tauri::menu::MenuBuilder::new(app)
        .items(&[&open, &toggle, &quit])
        .build()?;

    let tooltip = if state.paused.load(Ordering::SeqCst) {
        "Quill — Paused"
    } else {
        "Quill — Active"
    };

    let toggle_captured = toggle.clone();

    let icon = app.default_window_icon().cloned();

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip(tooltip);

    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }

    tray.on_menu_event(move |app, event| {
            let s = app.state::<Arc<AppState>>();
            match event.id().as_ref() {
                "open_settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "toggle_pause" => {
                    let was_paused = s.paused.fetch_xor(true, Ordering::SeqCst);
                    let now = !was_paused;
                    let _ = app.emit("paused-changed", now);
                    let label = if now { "Resume" } else { "Pause" };
                    let _ = toggle_captured.set_text(label);
                    if let Some(tray) = app.tray_by_id("main") {
                        let tip = if now { "Quill — Paused" } else { "Quill — Active" };
                        let _ = tray.set_tooltip(Some(tip));
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
