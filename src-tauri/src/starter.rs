use serde::{Deserialize, Serialize};
use rusqlite::Connection;

#[derive(Debug, Deserialize)]
pub struct StarterSnippet {
    pub trigger: String,
    pub expansion: String,
}

#[derive(Debug, Serialize)]
pub struct StarterPackResult {
    pub snippets_added: u32,
    pub duplicates_skipped: u32,
}

fn load_pack(name: &str) -> Result<Vec<StarterSnippet>, String> {
    let json = match name {
        "emoji" => include_str!("../assets/emoji.json"),
        _ => return Err(format!("Unknown starter pack: {}", name)),
    };
    serde_json::from_str(json).map_err(|e| format!("Failed to parse starter pack '{}': {}", name, e))
}

fn folder_name_for(name: &str) -> &str {
    match name {
        "emoji" => "Emoji",
        _ => name,
    }
}

fn folder_color_for(name: &str) -> &str {
    match name {
        "emoji" => "#f59e0b",
        _ => "",
    }
}

pub fn install_pack(conn: &Connection, name: &str) -> Result<StarterPackResult, String> {
    let snippets = load_pack(name)?;
    let display_name = folder_name_for(name);
    let color = folder_color_for(name);

    let folder_id = match crate::db::get_folder_by_name(conn, display_name)
        .map_err(|e| e.to_string())?
    {
        Some(f) => f.id,
        None => crate::db::add_folder(conn, display_name, color)
            .map_err(|e| e.to_string())?,
    };

    // Clean up old-format triggers (with trailing colon) so they don't linger as orphans
    // after a format change like :joy: → :joy
    for s in &snippets {
        let old = format!("{}:", s.trigger);
        let _ = conn.execute("DELETE FROM snippets WHERE trigger = ?1", rusqlite::params![old]);
    }

    // Gather existing new-format triggers for duplicate checking
    let existing_triggers: Vec<String> = crate::db::get_all_triggers(conn)
        .map_err(|e| e.to_string())?
        .iter()
        .map(|(_, t, _, _, _)| t.clone())
        .collect();

    let mut added = 0u32;
    let mut skipped = 0u32;

    for s in &snippets {
        if existing_triggers.contains(&s.trigger) {
            skipped += 1;
        } else {
            crate::db::add_snippet(conn, &s.trigger, &s.expansion, true, "[]", Some(folder_id))
                .map_err(|e| e.to_string())?;
            added += 1;
        }
    }

    Ok(StarterPackResult { snippets_added: added, duplicates_skipped: skipped })
}
