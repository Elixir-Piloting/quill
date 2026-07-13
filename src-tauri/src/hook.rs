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
                let current = {
                    let buf = state.buffer.lock().unwrap();
                    buf.clone()
                };

                let triggers = match state.db.lock() {
                    Ok(conn) => db::get_all_triggers(&conn).unwrap_or_default(),
                    Err(_) => return,
                };

                for (trigger, expansion, whole_word) in &triggers {
                    if matches_trigger(&current, trigger, *whole_word) {
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

fn matches_trigger(buffer: &str, trigger: &str, whole_word: bool) -> bool {
    if !buffer.ends_with(trigger) {
        return false;
    }

    if !whole_word {
        return true;
    }

    let prefix_len = buffer.len() - trigger.len();
    if prefix_len == 0 {
        return true;
    }

    let first = trigger.chars().next().unwrap();
    if !first.is_alphanumeric() && first != '_' {
        return true;
    }

    let prev = buffer.as_bytes()[prefix_len - 1] as char;
    !prev.is_alphanumeric() && prev != '_'
}
