use std::sync::{atomic::AtomicBool, Mutex};

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub buffer: Mutex<String>,
    pub paused: AtomicBool,
    pub injecting: AtomicBool,
    pub cancelling: AtomicBool,
}
