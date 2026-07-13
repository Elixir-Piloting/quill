use std::sync::{
    atomic::Ordering,
    Arc,
};

use rdev::{listen, Event, EventType};

use crate::{db, injection, state::AppState};

const MAX_BUFFER_SIZE: usize = 30;

pub fn start_hook(state: Arc<AppState>) {
    let _ = listen(move |event: Event| {
        if state.injecting.load(Ordering::SeqCst) {
            return;
        }

        if state.paused.load(Ordering::SeqCst) {
            return;
        }

        match event.event_type {
            EventType::KeyPress(_) => {
                let ch = match event.name.as_deref().and_then(|s| s.chars().next()) {
                    Some(c) => c,
                    None => return,
                };

                let mut buffer = state.buffer.lock().unwrap();
                buffer.push(ch);

                if buffer.len() > MAX_BUFFER_SIZE {
                    let excess = buffer.len() - MAX_BUFFER_SIZE;
                    buffer.drain(0..excess);
                }
            }

            EventType::KeyRelease(_) => {
                // Check triggers on key release — by this point the OS
                // has fully delivered the corresponding KeyPress to the
                // target application, so the character is already rendered.
                let current = {
                    let buf = state.buffer.lock().unwrap();
                    buf.clone()
                };

                let triggers = match state.db.lock() {
                    Ok(conn) => db::get_all_triggers(&conn).unwrap_or_default(),
                    Err(_) => return,
                };

                for (trigger, expansion) in &triggers {
                    if matches_trigger(&current, trigger) {
                        if let Ok(mut buf) = state.buffer.lock() {
                            buf.clear();
                        }
                        injection::replace_text(trigger, expansion, &state);
                        break;
                    }
                }
            }

            _ => {}
        }
    });
}

/// Returns true when `buffer` ends with `trigger` and the trigger is
/// preceded by a word boundary (or is self-delimiting because it starts
/// with a non-word character like `;`).
fn matches_trigger(buffer: &str, trigger: &str) -> bool {
    if !buffer.ends_with(trigger) {
        return false;
    }

    let prefix_len = buffer.len() - trigger.len();
    if prefix_len == 0 {
        return true;
    }

    // If the trigger starts with a non-word character (e.g. `;`, `!`, `:`)
    // it acts as its own delimiter — "abc;addr" still matches.
    let first = trigger.chars().next().unwrap();
    if !first.is_alphanumeric() && first != '_' {
        return true;
    }

    // Require a word boundary before the trigger
    let prev = buffer.as_bytes()[prefix_len - 1] as char;
    !prev.is_alphanumeric() && prev != '_'
}
