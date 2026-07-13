mod db;
mod hook;
mod injection;
mod state;
mod tray;

use std::sync::{atomic::Ordering, Arc};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use db::{Snippet, Variable};
use state::AppState;

// ── Snippet commands ──

#[tauri::command]
fn get_snippets(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Snippet>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_snippets(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    trigger: String,
    expansion: String,
    whole_word: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_snippet(&conn, &trigger, &expansion, whole_word).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    trigger: String,
    expansion: String,
    whole_word: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_snippet(&conn, id, &trigger, &expansion, whole_word).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_snippet(&conn, id).map_err(|e| e.to_string())
}

// ── Variable commands ──

#[tauri::command]
fn get_variables(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Variable>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_variables(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_variable(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
    value: String,
    kind: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_variable(&conn, &name, &value, &kind).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_variable(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    name: String,
    value: String,
    kind: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_variable(&conn, id, &name, &value, &kind).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_variable(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_variable(&conn, id).map_err(|e| e.to_string())
}

// ── State commands ──

#[tauri::command]
fn toggle_paused(state: tauri::State<'_, Arc<AppState>>) -> bool {
    !state.paused.fetch_xor(true, Ordering::SeqCst)
}

#[tauri::command]
fn get_paused(state: tauri::State<'_, Arc<AppState>>) -> bool {
    state.paused.load(Ordering::SeqCst)
}

// ── Popup commands ──

#[tauri::command]
fn inject_from_popup(expansion: String, state: tauri::State<'_, Arc<AppState>>) {
    injection::inject_text(&expansion, &state.inner());
}

#[tauri::command]
fn get_cursor_position() -> (f64, f64) {
    #[cfg(windows)]
    unsafe {
        use std::mem::MaybeUninit;
        let mut pt = MaybeUninit::zeroed();
        if windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(pt.as_mut_ptr()) != 0 {
            let pt = pt.assume_init();
            return (pt.x as f64, pt.y as f64);
        }
    }
    (0.0, 0.0)
}

#[tauri::command]
fn get_hotkey(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_setting(&conn, "hotkey")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "Alt+Space".to_string()))
}

#[tauri::command]
fn set_hotkey(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    hotkey: String,
) -> Result<(), String> {
    let old_hotkey = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "hotkey").map_err(|e| e.to_string())?
    };

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::set_setting(&conn, "hotkey", &hotkey).map_err(|e| e.to_string())?;
    }

    if let Some(old) = old_hotkey {
        if let Ok(shortcut) = parse_hotkey(&old) {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }

    let shortcut = parse_hotkey(&hotkey)?;
    let _ = app.global_shortcut().register(shortcut);
    Ok(())
}

#[tauri::command]
fn open_search_popup(app: tauri::AppHandle) {
    let _ = toggle_popup(&app);
}

fn toggle_popup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let cursor = get_cursor_position();

    if let Some(popup) = app.get_webview_window("search") {
        let visible = popup.is_visible().ok();
        if visible == Some(true) {
            let _ = popup.hide();
        } else {
            let _ = popup.set_position(tauri::PhysicalPosition::new(
                (cursor.0 - 200.0).max(0.0) as i32,
                cursor.1 as i32,
            ));
            let _ = popup.show();
            let _ = popup.set_focus();
        }
    } else {
        let popup = WebviewWindowBuilder::new(app, "search", WebviewUrl::App("index.html".into()))
            .decorations(false)
            .always_on_top(true)
            .inner_size(400.0, 480.0)
            .position((cursor.0 - 200.0).max(0.0), cursor.1)
            .title("Quill Search")
            .build()?;
        let _ = popup.set_focus();
    }
    Ok(())
}

fn parse_hotkey(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    let mut modifiers = Modifiers::empty();
    let mut code = None;

    for part in parts {
        match part.to_lowercase().as_str() {
            "alt" => modifiers |= Modifiers::ALT,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "win" | "cmd" => modifiers |= Modifiers::SUPER,
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            "escape" | "esc" => code = Some(Code::Escape),
            "tab" => code = Some(Code::Tab),
            "a" => code = Some(Code::KeyA),
            "b" => code = Some(Code::KeyB),
            "c" => code = Some(Code::KeyC),
            "d" => code = Some(Code::KeyD),
            "e" => code = Some(Code::KeyE),
            "f" => code = Some(Code::KeyF),
            "g" => code = Some(Code::KeyG),
            "h" => code = Some(Code::KeyH),
            "i" => code = Some(Code::KeyI),
            "j" => code = Some(Code::KeyJ),
            "k" => code = Some(Code::KeyK),
            "l" => code = Some(Code::KeyL),
            "m" => code = Some(Code::KeyM),
            "n" => code = Some(Code::KeyN),
            "o" => code = Some(Code::KeyO),
            "p" => code = Some(Code::KeyP),
            "q" => code = Some(Code::KeyQ),
            "r" => code = Some(Code::KeyR),
            "s" => code = Some(Code::KeyS),
            "t" => code = Some(Code::KeyT),
            "u" => code = Some(Code::KeyU),
            "v" => code = Some(Code::KeyV),
            "w" => code = Some(Code::KeyW),
            "x" => code = Some(Code::KeyX),
            "y" => code = Some(Code::KeyY),
            "z" => code = Some(Code::KeyZ),
            "f1" => code = Some(Code::F1),
            "f2" => code = Some(Code::F2),
            "f3" => code = Some(Code::F3),
            "f4" => code = Some(Code::F4),
            "f5" => code = Some(Code::F5),
            "f6" => code = Some(Code::F6),
            "f7" => code = Some(Code::F7),
            "f8" => code = Some(Code::F8),
            "f9" => code = Some(Code::F9),
            "f10" => code = Some(Code::F10),
            "f11" => code = Some(Code::F11),
            "f12" => code = Some(Code::F12),
            _ => return Err(format!("Unknown key: {}", part)),
        }
    }

    let c = code.ok_or_else(|| "No key specified in hotkey".to_string())?;
    Ok(Shortcut::new(Some(modifiers), c))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = toggle_popup(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            let db_path = app_data_dir.join("quill.db");
            let conn = db::init_db(db_path.to_str().unwrap()).expect("failed to init db");
            db::seed_defaults(&conn).expect("failed to seed defaults");

            let app_state = Arc::new(AppState {
                db: std::sync::Mutex::new(conn),
                buffer: std::sync::Mutex::new(String::new()),
                paused: std::sync::atomic::AtomicBool::new(false),
                injecting: std::sync::atomic::AtomicBool::new(false),
            });

            let _ = tray::setup_tray(app.handle(), app_state.clone());

            let hook_state = app_state.clone();
            std::thread::spawn(move || {
                hook::start_hook(hook_state);
            });

            let hotkey_str = {
                let conn = app_state.db.lock().unwrap();
                db::get_setting(&conn, "hotkey")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "Alt+Space".to_string())
            };
            if let Ok(shortcut) = parse_hotkey(&hotkey_str) {
                let _ = app.global_shortcut().register(shortcut);
            }

            app.manage(app_state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snippets,
            add_snippet,
            update_snippet,
            delete_snippet,
            get_variables,
            add_variable,
            update_variable,
            delete_variable,
            toggle_paused,
            get_paused,
            inject_from_popup,
            get_cursor_position,
            get_hotkey,
            set_hotkey,
            open_search_popup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
