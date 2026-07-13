mod db;
mod hook;
mod injection;
mod state;
mod tray;

use std::sync::{atomic::Ordering, Arc};

use tauri::Manager;

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
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_snippet(&conn, &trigger, &expansion).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_snippet(
    state: tauri::State<'_, Arc<AppState>>,
    id: i64,
    trigger: String,
    expansion: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_snippet(&conn, id, &trigger, &expansion).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
