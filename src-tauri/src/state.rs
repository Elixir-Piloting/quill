use std::sync::{atomic::AtomicBool, Mutex};

use crate::db;

pub struct PendingFormData {
    pub trigger: String,
    pub expansion: String,
    pub fields: Vec<db::FormInput>,
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub buffer: Mutex<String>,
    pub paused: AtomicBool,
    pub injecting: AtomicBool,
    pub cancelling: AtomicBool,
    pub pending_form: Mutex<Option<PendingFormData>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}
