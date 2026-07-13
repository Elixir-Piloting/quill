use std::sync::{atomic::Ordering, Arc};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::state::AppState;

pub fn setup_tray(app: &AppHandle, state: Arc<AppState>) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open_settings", "Open Settings").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle_pause", "Pause").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&open, &toggle, &quit])
        .build()?;

    let tooltip = if state.paused.load(Ordering::SeqCst) {
        "Quill — Paused"
    } else {
        "Quill — Active"
    };

    TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip(tooltip)
        .on_menu_event(move |app, event| {
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
