use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::Duration;

use arboard::Clipboard;
use chrono::Local;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

use crate::db;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CasingMode {
    Lower,
    Upper,
    Capital,
    Mixed,
}

pub fn detect_casing(typed_trigger: &str, stored_trigger: &str) -> CasingMode {
    if !stored_trigger.chars().any(|c| c.is_alphabetic()) {
        return CasingMode::Lower;
    }
    let letters: String = typed_trigger.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return CasingMode::Lower;
    }
    if letters.chars().all(|c| c.is_lowercase()) {
        return CasingMode::Lower;
    }
    if letters.chars().all(|c| c.is_uppercase()) {
        return CasingMode::Upper;
    }
    if let Some(first) = letters.chars().next() {
        if first.is_uppercase() {
            let rest: String = letters.chars().skip(1).collect();
            if rest.chars().all(|c| c.is_lowercase()) {
                return CasingMode::Capital;
            }
        }
    }
    CasingMode::Mixed
}

fn apply_casing(text: &str, mode: CasingMode) -> String {
    match mode {
        CasingMode::Lower | CasingMode::Mixed => text.to_string(),
        CasingMode::Upper => text.to_uppercase(),
        CasingMode::Capital => {
            let mut chars = text.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().to_string() + chars.as_str(),
            }
        }
    }
}

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

/// Inject text at the current cursor position (no backspace).
pub fn inject_text(expansion: &str, state: &AppState) {
    inject_text_with_casing(expansion, state, CasingMode::Lower)
}

pub fn inject_text_with_casing(expansion: &str, state: &AppState, casing: CasingMode) {
    state.injecting.store(true, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(20));

    let processed = {
        let conn = state.db.lock().unwrap();
        process_cursor(expansion, &conn)
    };

    let final_text = apply_casing(&processed.0, casing);
    clipboard_paste(&final_text, state, processed.1);
    state.injecting.store(false, Ordering::SeqCst);
}

/// Backspace over trigger text (used before opening form popup).
pub fn backspace_text(trigger: &str, state: &AppState) {
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
    state.injecting.store(false, Ordering::SeqCst);
}

/// Replace trigger with expansion (backspace + paste).
pub fn replace_text(trigger: &str, expansion: &str, state: &AppState) {
    replace_text_with_casing(trigger, expansion, state, CasingMode::Lower)
}

pub fn replace_text_with_casing(trigger: &str, expansion: &str, state: &AppState, casing: CasingMode) {
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

    let final_text = apply_casing(&processed, casing);
    clipboard_paste(&final_text, state, cursor_left);
    state.injecting.store(false, Ordering::SeqCst);
}

/// Resolve form variable placeholders with user-provided values,
/// then process remaining variables and inject.
pub fn inject_form_text(
    expansion: &str,
    form_values: &HashMap<String, String>,
    state: &AppState,
) {
    inject_form_text_with_casing(expansion, form_values, state, CasingMode::Lower)
}

pub fn inject_form_text_with_casing(
    expansion: &str,
    form_values: &HashMap<String, String>,
    state: &AppState,
    casing: CasingMode,
) {
    state.injecting.store(true, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(20));

    // Replace form input placeholders with user values first
    let mut resolved = expansion.to_string();
    for (name, value) in form_values {
        let placeholder = format!("{{{}}}", name);
        resolved = resolved.replace(&placeholder, value);
    }

    let processed = {
        let conn = state.db.lock().unwrap();
        process_cursor(&resolved, &conn)
    };

    let final_text = apply_casing(&processed.0, casing);
    clipboard_paste(&final_text, state, processed.1);
    state.injecting.store(false, Ordering::SeqCst);
}
