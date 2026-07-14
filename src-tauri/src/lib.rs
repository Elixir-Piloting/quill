mod db;
mod export;
mod hook;
mod injection;
mod process;
mod starter;
mod state;
mod tray;
mod uia;

use std::collections::HashMap;
use std::sync::{atomic::Ordering, Arc, Mutex};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use db::{Folder, FormInput, Snippet, Variable};
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
    app_scope: String,
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_snippet(&conn, &trigger, &expansion, whole_word, &app_scope, folder_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    trigger: String,
    expansion: String,
    whole_word: bool,
    app_scope: String,
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_snippet(&conn, id, &trigger, &expansion, whole_word, &app_scope, folder_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_snippet(&conn, id).map_err(|e| e.to_string())
}

// ── Folder commands ──

#[tauri::command]
fn get_folders(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Folder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_folder(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
    color: String,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_folder(&conn, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_folder(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_folder(&conn, id, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_folder(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_folder(&conn, id).map_err(|e| e.to_string())
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
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_variable(&conn, &name, &value, &kind, folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_variable(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    name: String,
    value: String,
    kind: String,
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_variable(&conn, id, &name, &value, &kind, folder_id).map_err(|e| e.to_string())
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
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_form_input(&conn, &name, &label, &fieldType, &placeholder, &defaultValue, required, folder_id).map_err(|e| e.to_string())
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
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_form_input(&conn, id, &name, &label, &fieldType, &placeholder, &defaultValue, required, folder_id).map_err(|e| e.to_string())
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
    let result = pf.as_ref().map(|f| (f.trigger.clone(), f.expansion.clone(), f.fields.clone()));
    eprintln!("[quill] get_pending_form called — returning: {:?}", result.as_ref().map(|(t, _, _)| t.as_str()));
    Ok(result)
}

#[tauri::command]
fn submit_form_injection(
    state: tauri::State<'_, Arc<AppState>>,
    values: HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    eprintln!("[quill] submit_form_injection entered");
    let pending = state.pending_form.lock().map_err(|e| e.to_string())?.take();
    if let Some(data) = pending {
        eprintln!("[quill] submit_form_injection: got pending data, trigger={}", data.trigger);
        let casing = injection::detect_casing(&data.typed_trigger, &data.trigger);
        if let Some(popup) = app.get_webview_window("form") {
            eprintln!("[quill] submit_form_injection: hiding form window");
            let _ = popup.hide();
        } else {
            eprintln!("[quill] submit_form_injection: form window not found");
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        eprintln!("[quill] submit_form_injection: injecting form text");
        injection::inject_form_text_with_casing(&data.expansion, &values, state.inner(), casing);
    } else {
        eprintln!("[quill] submit_form_injection: no pending data found");
    }
    Ok(())
}

#[tauri::command]
fn cancel_form_injection(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    eprintln!("[quill] cancel_form_injection called");
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

// ── App-scope commands ──

#[tauri::command]
fn get_running_apps() -> Vec<process::AppEntry> {
    process::get_running_apps()
}

// ── Starter pack command ──

#[tauri::command]
fn install_starter_pack(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> Result<starter::StarterPackResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    starter::install_pack(&conn, &name)
}

// ── Import/Export commands ──

#[tauri::command]
fn export_data(
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let json = export::build_export(&conn)?;
    export::write_export_json(&path, &json)
}

#[tauri::command]
fn validate_import(
    _state: tauri::State<'_, Arc<AppState>>,
    path: String,
) -> Result<export::ImportPreview, String> {
    let json = export::read_import_json(&path)?;
    export::validate_import(&json)
}

#[tauri::command]
fn execute_import(
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
    mode: String,
) -> Result<export::ImportResult, String> {
    let json = export::read_import_json(&path)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    export::execute_import(&conn, &json, &mode)
}

// ── Popup commands ──

#[tauri::command]
fn close_and_inject(trigger: String, expansion: String, state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) {
    eprintln!("[quill] close_and_inject entered — trigger={trigger}, expansion={expansion}");
    state.cancelling.store(false, Ordering::SeqCst);

    // Hide search popup immediately
    if let Some(popup) = app.get_webview_window("search") {
        eprintln!("[quill] close_and_inject: hiding search popup");
        let _ = popup.hide();
    } else {
        eprintln!("[quill] close_and_inject: search popup not found");
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    eprintln!("[quill] close_and_inject: 300ms sleep done");

    // Check for form inputs — if found, show form popup; else inject directly
    let mut has_form = false;
    if let Ok(conn) = state.db.lock() {
        let form_inputs = db::get_all_form_inputs(&conn).unwrap_or_default();
        let referenced: Vec<_> = form_inputs.into_iter()
            .filter(|f| expansion.contains(&format!("{{{}}}", f.name)))
            .collect();
        has_form = !referenced.is_empty();
        eprintln!("[quill] close_and_inject: has_form={has_form}, referenced_count={}", referenced.len());
        if has_form {
            let _ = state.pending_form.lock().map(|mut pf| {
                *pf = Some(crate::state::PendingFormData {
                    trigger: trigger.clone(),
                    typed_trigger: String::new(),
                    expansion: expansion.clone(),
                    fields: referenced.clone(),
                });
                eprintln!("[quill] close_and_inject: pending_form set with trigger={trigger}");
            });
            if let Some(handle) = state.app_handle.lock().ok().and_then(|g| g.as_ref().cloned()) {
                eprintln!("[quill] close_and_inject: calling show_form_window");
                hook::show_form_window(&handle);
            } else {
                eprintln!("[quill] close_and_inject: failed to get app_handle");
            }
        }
    } else {
        eprintln!("[quill] close_and_inject: db lock failed");
    }

    if !has_form {
        eprintln!("[quill] close_and_inject: injecting text directly");
        injection::inject_text(&expansion, &state.inner());
    }

    if let Some(popup) = app.get_webview_window("search") {
        eprintln!("[quill] close_and_inject: closing search popup");
        let _ = popup.close();
    }
    eprintln!("[quill] close_and_inject: done");
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
            other if other.len() == 1 => {
                let c = other.chars().next().unwrap();
                if c.is_ascii_lowercase() {
                    code = Some(match c {
                        'a' => Code::KeyA, 'b' => Code::KeyB, 'c' => Code::KeyC,
                        'd' => Code::KeyD, 'e' => Code::KeyE, 'f' => Code::KeyF,
                        'g' => Code::KeyG, 'h' => Code::KeyH, 'i' => Code::KeyI,
                        'j' => Code::KeyJ, 'k' => Code::KeyK, 'l' => Code::KeyL,
                        'm' => Code::KeyM, 'n' => Code::KeyN, 'o' => Code::KeyO,
                        'p' => Code::KeyP, 'q' => Code::KeyQ, 'r' => Code::KeyR,
                        's' => Code::KeyS, 't' => Code::KeyT, 'u' => Code::KeyU,
                        'v' => Code::KeyV, 'w' => Code::KeyW, 'x' => Code::KeyX,
                        'y' => Code::KeyY, 'z' => Code::KeyZ,
                        _ => return Err(format!("Unknown key: {}", part)),
                    });
                } else if c.is_ascii_digit() {
                    code = Some(match c {
                        '0' => Code::Digit0, '1' => Code::Digit1, '2' => Code::Digit2,
                        '3' => Code::Digit3, '4' => Code::Digit4, '5' => Code::Digit5,
                        '6' => Code::Digit6, '7' => Code::Digit7, '8' => Code::Digit8,
                        '9' => Code::Digit9,
                        _ => return Err(format!("Unknown key: {}", part)),
                    });
                } else {
                    return Err(format!("Unknown key: {}", part));
                }
            }
            other if other.starts_with('f') && other[1..].chars().all(|c| c.is_ascii_digit()) => {
                return Err("Function keys not supported in hotkey combination".into());
            }
            _ => return Err(format!("Unknown key: {}", part)),
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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

            let app_state = Arc::new(AppState {
                db: Mutex::new(conn),
                buffer: Mutex::new(String::new()),
                paused: std::sync::atomic::AtomicBool::new(false),
                injecting: std::sync::atomic::AtomicBool::new(false),
                cancelling: std::sync::atomic::AtomicBool::new(false),
                pending_form: Mutex::new(None),
                app_handle: Mutex::new(Some(app.handle().clone())),
            });

            // Create hidden form window (must be done on main thread)
            if let Err(e) = WebviewWindowBuilder::new(app.handle(), "form", WebviewUrl::App("index.html".into()))
                .decorations(false)
                .always_on_top(true)
                .inner_size(440.0, 320.0)
                .center()
                .title("Quill")
                .build()
            {
                eprintln!("[quill] Failed to create form window at startup: {e}");
            } else {
                eprintln!("[quill] Form window created at startup");
            }

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
            get_folders,
            add_folder,
            update_folder,
            delete_folder,
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
            get_running_apps,
            export_data,
            validate_import,
            execute_import,
            install_starter_pack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
