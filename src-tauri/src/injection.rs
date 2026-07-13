use std::sync::atomic::Ordering;
use std::time::Duration;

use arboard::Clipboard;
use chrono::Local;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

use crate::db;
use crate::state::AppState;

fn clipboard_paste(text: &str, state: &AppState, cursor_left: Option<usize>) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(_) => {
            state.injecting.store(false, Ordering::SeqCst);
            return;
        }
    };

    let mut clipboard = Clipboard::new().ok();
    let saved = clipboard.as_mut().and_then(|c| c.get_text().ok());

    if let Some(ref mut clip) = clipboard {
        let _ = clip.set_text(text);
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

    if let Some(offset) = cursor_left {
        if offset > 0 {
            crate::uia::try_set_cursor(offset);
        }
    }
}

fn process_variables(text: &str, conn: &rusqlite::Connection) -> String {
    let mut result = text.to_string();
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

fn process_cursor(text: &str, conn: &rusqlite::Connection) -> (String, Option<usize>) {
    let cursor = "{cursor}";
    if let Some(pos) = text.find(cursor) {
        let before = &text[..pos];
        let after = &text[pos + cursor.len()..];
        let processed_before = process_variables(before, conn);
        let processed_after = process_variables(after, conn);
        let left = processed_after.chars().count();
        (processed_before + &processed_after, Some(left))
    } else {
        (process_variables(text, conn), None)
    }
}

/// Injects text at the current cursor position (no backspace).
/// Handles {cursor} marker and variable resolution.
pub fn inject_text(expansion: &str, state: &AppState) {
    state.injecting.store(true, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(20));

    let processed = {
        let conn = state.db.lock().unwrap();
        process_cursor(expansion, &conn)
    };

    clipboard_paste(&processed.0, state, processed.1);
    state.injecting.store(false, Ordering::SeqCst);
}

/// Replaces trigger with expansion (backspace + paste).
/// Handles {cursor} marker, whole_word flag, and variable resolution.
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

    for _ in 0..trigger.chars().count() {
        let _ = enigo.key(Key::Backspace, Direction::Click);
        std::thread::sleep(Duration::from_millis(18));
    }

    std::thread::sleep(Duration::from_millis(60));

    let conn = state.db.lock().unwrap();
    let (processed, cursor_left) = process_cursor(expansion, &conn);
    drop(conn);

    clipboard_paste(&processed, state, cursor_left);
    state.injecting.store(false, Ordering::SeqCst);
}
