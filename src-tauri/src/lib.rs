mod db;
mod hook;
mod injection;
mod state;
mod tray;
mod uia;

use std::collections::HashMap;
use std::sync::{atomic::Ordering, Arc, Mutex};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use db::{FormInput, Snippet, Variable};
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

// ── Form Input commands ──

#[tauri::command]
fn get_form_inputs(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<FormInput>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_form_inputs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_form_input(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
    label: String,
    fieldType: String,
    placeholder: String,
    defaultValue: String,
    required: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_form_input(&conn, &name, &label, &fieldType, &placeholder, &defaultValue, required).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_form_input(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    name: String,
    label: String,
    fieldType: String,
    placeholder: String,
    defaultValue: String,
    required: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_form_input(&conn, id, &name, &label, &fieldType, &placeholder, &defaultValue, required).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_form_input(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_form_input(&conn, id).map_err(|e| e.to_string())
}

// ── Pending form commands ──

#[tauri::command]
fn get_pending_form(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<(String, String, Vec<FormInput>)>, String> {
    let pf = state.pending_form.lock().map_err(|e| e.to_string())?;
    Ok(pf.as_ref().map(|f| (f.trigger.clone(), f.expansion.clone(), f.fields.clone())))
}

#[tauri::command]
fn submit_form_injection(
    state: tauri::State<'_, Arc<AppState>>,
    values: HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let pending = state.pending_form.lock().map_err(|e| e.to_string())?.take();
    if let Some(data) = pending {
        if let Some(popup) = app.get_webview_window("form") {
            let _ = popup.hide();
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        injection::inject_form_text(&data.expansion, &values, state.inner());
        if let Some(popup) = app.get_webview_window("form") {
            let _ = popup.close();
        }
    }
    Ok(())
}

#[tauri::command]
fn cancel_form_injection(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut pending = state.pending_form.lock().map_err(|e| e.to_string())?;
    *pending = None;
    Ok(())
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
fn close_and_inject(expansion: String, state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) {
    state.cancelling.store(false, Ordering::SeqCst);
    if let Some(popup) = app.get_webview_window("search") {
        let _ = popup.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    injection::inject_text(&expansion, &state.inner());
    if let Some(popup) = app.get_webview_window("search") {
        let _ = popup.close();
    }
}

#[tauri::command]
fn cancel_injection(state: tauri::State<'_, Arc<AppState>>) {
    state.cancelling.store(true, Ordering::SeqCst);
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
    if let Some(popup) = app.get_webview_window("search") {
        let visible = popup.is_visible().ok();
        if visible == Some(true) {
            let _ = popup.hide();
        } else {
            let _ = popup.show();
            let _ = popup.set_focus();
        }
    } else {
        let popup = WebviewWindowBuilder::new(app, "search", WebviewUrl::App("index.html".into()))
            .decorations(false)
            .always_on_top(true)
            .inner_size(400.0, 360.0)
            .center()
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
            other => {
                let is_valid = other.len() == 1 && other.chars().all(|c| c.is_ascii_lowercase())
                    || other.len() > 1 && other.starts_with('f') && other[1..].chars().all(|c| c.is_ascii_digit());
                if !is_valid {
                    return Err(format!("Unknown key: {}", part));
                }
            }
        }
    }

    let c = code.ok_or_else(|| "No key specified in hotkey".to_string())?;
    Ok(Shortcut::new(Some(modifiers), c))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::default().build())
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
                db: Mutex::new(conn),
                buffer: Mutex::new(String::new()),
                paused: std::sync::atomic::AtomicBool::new(false),
                injecting: std::sync::atomic::AtomicBool::new(false),
                cancelling: std::sync::atomic::AtomicBool::new(false),
                pending_form: Mutex::new(None),
                app_handle: Mutex::new(Some(app.handle().clone())),
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
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
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
            get_form_inputs,
            add_form_input,
            update_form_input,
            delete_form_input,
            get_pending_form,
            submit_form_injection,
            cancel_form_injection,
            toggle_paused,
            get_paused,
            close_and_inject,
            cancel_injection,
            get_cursor_position,
            get_hotkey,
            set_hotkey,
            open_search_popup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
