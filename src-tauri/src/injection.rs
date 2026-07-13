use std::sync::atomic::Ordering;
use std::time::Duration;

use arboard::Clipboard;
use chrono::Local;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rusqlite::Connection;

use crate::db;
use crate::state::AppState;

pub fn replace_text(trigger: &str, expansion: &str, state: &AppState) {
    state.injecting.store(true, Ordering::SeqCst);

    std::thread::sleep(Duration::from_millis(20));

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(_) => {
            state.injecting.store(false, Ordering::SeqCst);
            return;
        }
    };

    for _ in 0..trigger.len() {
        let _ = enigo.key(Key::Backspace, Direction::Click);
        std::thread::sleep(Duration::from_millis(18));
    }

    std::thread::sleep(Duration::from_millis(60));

    let processed = {
        let conn = state.db.lock().unwrap();
        process_variables(expansion, &conn)
    };

    let mut clipboard = Clipboard::new().ok();
    let saved = clipboard.as_mut().and_then(|c| c.get_text().ok());

    if let Some(ref mut clip) = clipboard {
        let _ = clip.set_text(processed);
    }

    std::thread::sleep(Duration::from_millis(15));

    let _ = enigo.key(Key::Control, Direction::Press);
    let _ = enigo.key(Key::V, Direction::Click);
    let _ = enigo.key(Key::Control, Direction::Release);

    std::thread::sleep(Duration::from_millis(30));

    if let Some(ref mut clip) = clipboard {
        if let Some(orig) = saved {
            let _ = clip.set_text(orig);
        }
    }

    state.injecting.store(false, Ordering::SeqCst);
}

fn process_variables(text: &str, conn: &Connection) -> String {
    let mut result = text.to_string();

    // User-defined variables — the only variable system.
    // On a fresh install `date` and `clipboard` are preseeded
    // as regular rows; users may edit or delete them freely.
    if let Ok(vars) = db::get_all_variables(conn) {
        for v in &vars {
            let placeholder = format!("{{{}}}", v.name);
            if !result.contains(&placeholder) {
                continue;
            }
            let replacement = match v.kind.as_str() {
                "date" => Local::now().format(&v.value).to_string(),
                "clipboard" => Clipboard::new()
                    .ok()
                    .and_then(|mut c| c.get_text().ok())
                    .unwrap_or_default(),
                _ => v.value.clone(),
            };
            result = result.replace(&placeholder, &replacement);
        }
    }

    result
}
