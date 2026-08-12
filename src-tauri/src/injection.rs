use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use arboard::Clipboard;
use chrono::Local;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::Emitter;

use crate::db;
use crate::scripts;
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

// ── Script-aware resolution ──
//
// Script variables resolve asynchronously, so expansion that references them
// runs on a background thread (never the keyboard hook listener) and never
// holds the DB lock across execution — the variable list is snapshotted first.

struct ExpansionContext {
    trigger: String,
    app: Option<String>,
}

fn emit_script_event(state: &AppState, payload: serde_json::Value) {
    if let Some(handle) = state.app_handle.lock().ok().and_then(|g| g.as_ref().cloned()) {
        let _ = handle.emit("script-expansion", payload);
    }
}

fn script_enabled(expansion: &str, state: &AppState) -> bool {
    let Ok(conn) = state.db.lock() else {
        return false;
    };
    match db::get_all_variables(&conn) {
        Ok(vars) => vars
            .iter()
            .any(|v| v.kind == "script" && expansion.contains(&format!("{{{}}}", v.name))),
        Err(_) => false,
    }
}

fn resolve_variable(
    v: &db::Variable,
    ctx: &ExpansionContext,
    resolved: &mut HashMap<String, String>,
) -> Result<String, String> {
    match v.kind.as_str() {
        "date" => Ok(Local::now().format(&v.value).to_string()),
        "clipboard" => Ok(Clipboard::new()
            .ok()
            .and_then(|mut c| c.get_text().ok())
            .unwrap_or_default()),
        "script" => {
            let config = scripts::parse_config(&v.value).map_err(|e| e.user_message())?;
            let script_ctx = scripts::ScriptContext {
                trigger: ctx.trigger.clone(),
                app: ctx.app.clone(),
                variables: resolved.clone(),
            };
            scripts::run_script_blocking(&config, &script_ctx).map_err(|e| e.user_message())
        }
        _ => Ok(v.value.clone()),
    }
}

fn resolve_expansion(text: &str, vars: &[db::Variable], ctx: &ExpansionContext) -> Result<String, String> {
    let mut result = text.to_string();
    let mut resolved: HashMap<String, String> = HashMap::new();
    for v in vars {
        let placeholder = format!("{{{}}}", v.name);
        if !result.contains(&placeholder) {
            continue;
        }
        let replacement = resolve_variable(v, ctx, &mut resolved)?;
        result = result.replace(&placeholder, &replacement);
        resolved.insert(v.name.clone(), replacement);
    }
    Ok(result)
}

fn process_expansion(
    text: &str,
    vars: &[db::Variable],
    ctx: &ExpansionContext,
) -> Result<(String, Option<usize>), String> {
    let cursor = "{cursor}";
    if let Some(pos) = text.find(cursor) {
        let before = &text[..pos];
        let after = &text[pos + cursor.len()..];
        let processed_before = resolve_expansion(before, vars, ctx)?;
        let processed_after = resolve_expansion(after, vars, ctx)?;
        let left = processed_after.chars().count();
        Ok((processed_before + &processed_after, Some(left)))
    } else {
        Ok((resolve_expansion(text, vars, ctx)?, None))
    }
}

fn resolve_blocking(
    expansion: &str,
    trigger: &str,
    state: &AppState,
) -> Result<(String, Option<usize>), String> {
    let vars = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_all_variables(&conn).map_err(|e| e.to_string())?
    };
    let ctx = ExpansionContext {
        trigger: trigger.to_string(),
        app: crate::process::get_foreground_exe(),
    };
    process_expansion(expansion, &vars, &ctx)
}

fn paste_expansion(text: &str, state: &AppState, cursor_left: Option<usize>, casing: CasingMode) {
    state.injecting.store(true, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(20));
    let final_text = apply_casing(text, casing);
    clipboard_paste(&final_text, state, cursor_left);
    state.injecting.store(false, Ordering::SeqCst);
}

/// Non-blocking variant of `replace_text_with_casing` for expansions that
/// reference Script variables. The trigger is backspaced immediately (so the
/// user can keep typing while the script runs), then scripts are resolved on a
/// background thread and the expansion is pasted when done.
pub fn replace_text_maybe_script(
    trigger: &str,
    expansion: &str,
    submit_on_completion: Option<db::SubmitOnCompletion>,
    state: &Arc<AppState>,
    casing: CasingMode,
) {
    if !script_enabled(expansion, state) {
        replace_text_with_casing(trigger, expansion, state, casing);
        schedule_submit(submit_on_completion, state);
        return;
    }

    let st = Arc::clone(state);
    let trigger = trigger.to_string();
    let expansion = expansion.to_string();
    std::thread::spawn(move || {
        // 1. Backspace the trigger immediately (mirrors backspace_text).
        state_injecting_backspace(&trigger, &st);
        // 2. Run scripts (may take a while — user can keep typing).
        emit_script_event(&st, serde_json::json!({ "running": true }));
        match resolve_blocking(&expansion, &trigger, &st) {
            Ok((text, cursor_left)) => {
                emit_script_event(&st, serde_json::json!({ "running": false }));
                paste_expansion(&text, &st, cursor_left, casing);
                schedule_submit(submit_on_completion, &st);
            }
            Err(err) => {
                emit_script_event(
                    &st,
                    serde_json::json!({ "running": false, "error": err }),
                );
            }
        }
    });
}

/// Non-blocking variant of `inject_text_with_casing` (no backspace — used by
/// the search popup path).
pub fn inject_text_maybe_script(
    trigger: &str,
    expansion: &str,
    submit_on_completion: Option<db::SubmitOnCompletion>,
    state: &Arc<AppState>,
    casing: CasingMode,
) {
    if !script_enabled(expansion, state) {
        inject_text_with_casing(expansion, state, casing);
        schedule_submit(submit_on_completion, state);
        return;
    }

    let st = Arc::clone(state);
    let trigger = trigger.to_string();
    let expansion = expansion.to_string();
    std::thread::spawn(move || {
        emit_script_event(&st, serde_json::json!({ "running": true }));
        match resolve_blocking(&expansion, &trigger, &st) {
            Ok((text, cursor_left)) => {
                emit_script_event(&st, serde_json::json!({ "running": false }));
                paste_expansion(&text, &st, cursor_left, casing);
                schedule_submit(submit_on_completion, &st);
            }
            Err(err) => {
                emit_script_event(
                    &st,
                    serde_json::json!({ "running": false, "error": err }),
                );
            }
        }
    });
}

/// Non-blocking variant of `inject_form_text_with_casing` for expansions that
/// reference Script variables alongside form inputs.
pub fn inject_form_text_maybe_script(
    trigger: &str,
    expansion: &str,
    form_values: &HashMap<String, String>,
    submit_on_completion: Option<db::SubmitOnCompletion>,
    state: &Arc<AppState>,
    casing: CasingMode,
) {
    if !script_enabled(expansion, state) {
        inject_form_text_with_casing(expansion, form_values, state, casing);
        schedule_submit(submit_on_completion, state);
        return;
    }

    let mut resolved = expansion.to_string();
    for (name, value) in form_values {
        let placeholder = format!("{{{}}}", name);
        resolved = resolved.replace(&placeholder, value);
    }

    let st = Arc::clone(state);
    let trigger = trigger.to_string();
    std::thread::spawn(move || {
        // No backspace here: the trigger is already removed before the form
        // popup is shown (backspace_text in the keyboard path, or no trigger
        // text in the search-popup path).
        emit_script_event(&st, serde_json::json!({ "running": true }));
        match resolve_blocking(&resolved, &trigger, &st) {
            Ok((text, cursor_left)) => {
                emit_script_event(&st, serde_json::json!({ "running": false }));
                paste_expansion(&text, &st, cursor_left, casing);
                schedule_submit(submit_on_completion, &st);
            }
            Err(err) => {
                emit_script_event(
                    &st,
                    serde_json::json!({ "running": false, "error": err }),
                );
            }
        }
    });
}

fn state_injecting_backspace(trigger: &str, state: &AppState) {
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

/// Inject text at the current cursor position (no backspace).
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

// ── Submit-on-completion ──
//
// After an expansion's text has been fully injected, an optional configured
// key press (default Enter) is sent so the active app might, e.g., submit a
// chat reply. It is always scheduled — never sent synchronously in the same
// tick as the paste — with a small delay so slower-rendering target apps have
// settled. Failures are logged and dropped (no retries, no double submits).

fn schedule_submit(submit: Option<db::SubmitOnCompletion>, state: &Arc<AppState>) {
    let Some(submit) = submit else { return };
    if !submit.enabled {
        return;
    }
    let st = Arc::clone(state);
    std::thread::spawn(move || {
        let delay_ms = submit.delay_ms.clamp(0, 1000) as u64;
        // Even at 0 ms, sleep(Duration::ZERO) still yields once, so the key is
        // never fired synchronously in the same tick as the text injection.
        std::thread::sleep(Duration::from_millis(delay_ms));
        send_submit_key(submit.key, &st);
    });
}

fn send_submit_key(key: db::SubmitKey, state: &AppState) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[quill] submit key: failed to init enigo: {err}");
            return;
        }
    };

    let send = |enigo: &mut Enigo| match key {
        db::SubmitKey::Enter => {
            let _ = enigo.key(Key::Return, Direction::Click);
        }
        db::SubmitKey::ShiftEnter => {
            let _ = enigo.key(Key::Shift, Direction::Press);
            let _ = enigo.key(Key::Return, Direction::Click);
            let _ = enigo.key(Key::Shift, Direction::Release);
        }
        db::SubmitKey::CtrlEnter => {
            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Return, Direction::Click);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
        db::SubmitKey::Tab => {
            let _ = enigo.key(Key::Tab, Direction::Click);
        }
    };

    state.injecting.store(true, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(20));
    send(&mut enigo);
    std::thread::sleep(Duration::from_millis(30));
    state.injecting.store(false, Ordering::SeqCst);
}
