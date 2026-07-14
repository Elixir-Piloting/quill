use std::sync::{
    atomic::Ordering,
    Arc,
};
use std::time::Duration;

use rdev::{listen, Event, EventType};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{db, injection, process, state::AppState};

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
                let ch = match event.name.as_deref() {
                    Some(s) if s.len() == 1 => s.chars().next().unwrap(),
                    _ => return,
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

                let foreground_exe = process::get_foreground_exe();

                let mut matched_idx: Option<usize> = None;
                for (i, (_sid, trigger, _expansion, whole_word, app_scope)) in triggers.iter().enumerate() {
                    if !matches_trigger(&current, trigger, *whole_word) {
                        continue;
                    }

                    let is_global = app_scope == "[]" || app_scope.is_empty();
                    let scope_allowed = if is_global {
                        true
                    } else {
                        foreground_exe.as_ref().map_or(false, |exe| {
                            serde_json::from_str::<Vec<db::AppScopeEntry>>(app_scope)
                                .ok()
                                .map_or(false, |entries| entries.iter().any(|e| e.exe == *exe))
                        })
                    };

                    if scope_allowed {
                        matched_idx = Some(i);
                        break;
                    }
                }

                if let Some(idx) = matched_idx {
                    let (_sid, trigger, expansion, _whole_word, _app_scope) = &triggers[idx];
                    let typed_trigger: String = current.chars().rev().take(trigger.len()).collect::<Vec<_>>().into_iter().rev().collect();

                    if let Ok(mut buf) = state.buffer.lock() {
                        buf.clear();
                    }

                    let casing = injection::detect_casing(&typed_trigger, trigger);

                    // Check if expansion references any form inputs
                    let has_form = match state.db.lock() {
                        Ok(conn) => {
                            let form_inputs = db::get_all_form_inputs(&conn).unwrap_or_default();
                            let referenced = {
                                let mut v: Vec<_> = form_inputs
                                    .into_iter()
                                    .filter(|f| expansion.contains(&format!("{{{}}}", f.name)))
                                    .collect();
                                v.sort_by_key(|f| expansion.find(&format!("{{{}}}", f.name)).unwrap_or(usize::MAX));
                                v
                            };
                            if !referenced.is_empty() {
                                if let Ok(mut pf) = state.pending_form.lock() {
                                    *pf = Some(crate::state::PendingFormData {
                                        trigger: trigger.clone(),
                                        typed_trigger: typed_trigger.clone(),
                                        expansion: expansion.clone(),
                                        fields: referenced,
                                    });
                                }
                                true
                            } else {
                                false
                            }
                        }
                        Err(_) => false,
                    };

                    if has_form {
                        injection::backspace_text(trigger, &state);
                        if let Some(handle) = state.app_handle.lock().unwrap().as_ref() {
                            open_form_popup(handle);
                        }
                    } else {
                        injection::replace_text_with_casing(trigger, expansion, &state, casing);
                    }
                }
            }

            _ => {}
        }
    });
}

pub(crate) fn open_form_popup(app: &tauri::AppHandle) {
    if let Some(popup) = app.get_webview_window("form") {
        let _ = popup.eval("location.reload()");
        std::thread::sleep(Duration::from_millis(100));
        let _ = popup.show();
        let _ = popup.set_focus();
    } else if let Ok(popup) = WebviewWindowBuilder::new(app, "form", WebviewUrl::App("index.html".into()))
        .decorations(false)
        .always_on_top(true)
        .inner_size(440.0, 320.0)
        .center()
        .title("Quill")
        .build()
    {
        let _ = popup.set_focus();
    }
}

fn matches_trigger(buffer: &str, trigger: &str, whole_word: bool) -> bool {
    if buffer.len() < trigger.len() {
        return false;
    }

    let typed_trigger = &buffer[buffer.len() - trigger.len()..];
    if !typed_trigger.eq_ignore_ascii_case(trigger) {
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
