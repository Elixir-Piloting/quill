use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppScopeEntry {
    pub name: String,
    pub exe: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Snippet {
    pub id: i64,
    pub trigger: String,
    pub expansion: String,
    pub whole_word: bool,
    pub app_scope: String,
    pub folder_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Variable {
    pub id: i64,
    pub name: String,
    pub value: String,
    pub kind: String,
    pub folder_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormInput {
    pub id: i64,
    pub name: String,
    pub label: String,
    pub field_type: String,
    pub placeholder: String,
    pub default_value: String,
    pub required: bool,
    pub folder_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger TEXT NOT NULL UNIQUE,
            expansion TEXT NOT NULL,
            whole_word INTEGER NOT NULL DEFAULT 1,
            folder_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS variables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'text',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS form_inputs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            field_type TEXT NOT NULL DEFAULT 'text',
            placeholder TEXT NOT NULL DEFAULT '',
            default_value TEXT NOT NULL DEFAULT '',
            required INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    let _ = conn.execute_batch(
        "ALTER TABLE snippets ADD COLUMN whole_word INTEGER NOT NULL DEFAULT 1;",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE form_inputs ADD COLUMN field_type TEXT NOT NULL DEFAULT 'text';",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE snippets ADD COLUMN app_scope TEXT NOT NULL DEFAULT '[]';",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE snippets ADD COLUMN folder_id INTEGER REFERENCES folders(id);",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE variables ADD COLUMN folder_id INTEGER REFERENCES folders(id);",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE form_inputs ADD COLUMN folder_id INTEGER REFERENCES folders(id);",
    );

    // Ensure Uncategorized folder exists
    conn.execute(
        "INSERT OR IGNORE INTO folders (name, color, created_at) VALUES ('Uncategorized', '#64748b', datetime('now'))",
        [],
    )?;
    let uncat_id: i64 = conn.query_row(
        "SELECT id FROM folders WHERE name = 'Uncategorized'",
        [],
        |row| row.get(0),
    )?;
    // Seed defaults (will be migrated to uncat_id below)
    seed_defaults(&conn)?;
    // Migrate any existing nulls to Uncategorized
    conn.execute(
        "UPDATE snippets SET folder_id = ?1 WHERE folder_id IS NULL",
        params![uncat_id],
    )?;
    conn.execute(
        "UPDATE variables SET folder_id = ?1 WHERE folder_id IS NULL",
        params![uncat_id],
    )?;
    conn.execute(
        "UPDATE form_inputs SET folder_id = ?1 WHERE folder_id IS NULL",
        params![uncat_id],
    )?;

    Ok(conn)
}

// ── Folders ──

pub fn get_all_folders(conn: &Connection) -> Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, created_at FROM folders ORDER BY created_at DESC",
    )?;
    let folders = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(folders)
}

pub fn add_folder(conn: &Connection, name: &str, color: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO folders (name, color) VALUES (?1, ?2)",
        params![name, color],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_folder(conn: &Connection, id: i64, name: &str, color: &str) -> Result<()> {
    conn.execute(
        "UPDATE folders SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )?;
    Ok(())
}

pub fn get_or_create_uncategorized(conn: &Connection) -> Result<i64> {
    match conn.query_row(
        "SELECT id FROM folders WHERE name = 'Uncategorized'",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(id) => Ok(id),
        Err(_) => {
            conn.execute(
                "INSERT INTO folders (name, color) VALUES ('Uncategorized', '#64748b')",
                [],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

pub fn delete_folder(conn: &Connection, id: i64) -> Result<()> {
    let uncat_id = get_or_create_uncategorized(conn)?;
    conn.execute(
        "UPDATE snippets SET folder_id = ?1 WHERE folder_id = ?2",
        params![uncat_id, id],
    )?;
    conn.execute(
        "UPDATE variables SET folder_id = ?1 WHERE folder_id = ?2",
        params![uncat_id, id],
    )?;
    conn.execute(
        "UPDATE form_inputs SET folder_id = ?1 WHERE folder_id = ?2",
        params![uncat_id, id],
    )?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_folder_by_name(conn: &Connection, name: &str) -> Result<Option<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, created_at FROM folders WHERE name = ?1",
    )?;
    let mut rows = stmt.query(params![name])?;
    match rows.next()? {
        Some(row) => Ok(Some(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            created_at: row.get(3)?,
        })),
        None => Ok(None),
    }
}

// ── Snippets ──

pub fn get_all_snippets(conn: &Connection) -> Result<Vec<Snippet>> {
    let mut stmt = conn.prepare(
        "SELECT id, trigger, expansion, whole_word, app_scope, folder_id, created_at
         FROM snippets ORDER BY created_at DESC",
    )?;
    let snippets = stmt
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                trigger: row.get(1)?,
                expansion: row.get(2)?,
                whole_word: row.get::<_, i64>(3)? != 0,
                app_scope: row.get(4)?,
                folder_id: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(snippets)
}

pub fn add_snippet(
    conn: &Connection,
    trigger: &str,
    expansion: &str,
    whole_word: bool,
    app_scope: &str,
    folder_id: Option<i64>,
) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "INSERT INTO snippets (trigger, expansion, whole_word, app_scope, folder_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![trigger, expansion, whole_word as i64, app_scope, fid],
    )?;
    Ok(())
}

pub fn update_snippet(
    conn: &Connection,
    id: i64,
    trigger: &str,
    expansion: &str,
    whole_word: bool,
    app_scope: &str,
    folder_id: Option<i64>,
) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "UPDATE snippets SET trigger = ?1, expansion = ?2, whole_word = ?3, app_scope = ?4, folder_id = ?5 WHERE id = ?6",
        params![trigger, expansion, whole_word as i64, app_scope, fid, id],
    )?;
    Ok(())
}

pub fn delete_snippet(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_all_triggers(conn: &Connection) -> Result<Vec<(i64, String, String, bool, String)>> {
    let mut stmt = conn.prepare("SELECT id, trigger, expansion, whole_word, app_scope FROM snippets ORDER BY LENGTH(trigger) DESC")?;
    let triggers = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(triggers)
}

// ── Variables ──

pub fn get_all_variables(conn: &Connection) -> Result<Vec<Variable>> {
    let mut stmt =
        conn.prepare("SELECT id, name, value, kind, folder_id, created_at FROM variables ORDER BY created_at DESC")?;
    let vars = stmt
        .query_map([], |row| {
            Ok(Variable {
                id: row.get(0)?,
                name: row.get(1)?,
                value: row.get(2)?,
                kind: row.get(3)?,
                folder_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(vars)
}

pub fn add_variable(conn: &Connection, name: &str, value: &str, kind: &str, folder_id: Option<i64>) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "INSERT INTO variables (name, value, kind, folder_id) VALUES (?1, ?2, ?3, ?4)",
        params![name, value, kind, fid],
    )?;
    Ok(())
}

pub fn update_variable(conn: &Connection, id: i64, name: &str, value: &str, kind: &str, folder_id: Option<i64>) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "UPDATE variables SET name = ?1, value = ?2, kind = ?3, folder_id = ?4 WHERE id = ?5",
        params![name, value, kind, fid, id],
    )?;
    Ok(())
}

pub fn delete_variable(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM variables WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn seed_defaults(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "INSERT OR IGNORE INTO variables (name, value, kind) VALUES ('date', '%Y-%m-%d', 'date');
         INSERT OR IGNORE INTO variables (name, value, kind) VALUES ('clipboard', '', 'clipboard');
         INSERT OR IGNORE INTO settings (key, value) VALUES ('hotkey', 'Alt+Space');",
    )?;
    Ok(())
}

// ── Form Inputs ──

pub fn get_all_form_inputs(conn: &Connection) -> Result<Vec<FormInput>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, label, field_type, placeholder, default_value, required, folder_id, created_at
         FROM form_inputs ORDER BY created_at DESC",
    )?;
    let fields = stmt
        .query_map([], |row| {
            Ok(FormInput {
                id: row.get(0)?,
                name: row.get(1)?,
                label: row.get(2)?,
                field_type: row.get(3)?,
                placeholder: row.get(4)?,
                default_value: row.get(5)?,
                required: row.get::<_, i64>(6)? != 0,
                folder_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(fields)
}

pub fn add_form_input(conn: &Connection, name: &str, label: &str, field_type: &str, placeholder: &str, default_value: &str, required: bool, folder_id: Option<i64>) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "INSERT INTO form_inputs (name, label, field_type, placeholder, default_value, required, folder_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![name, label, field_type, placeholder, default_value, required as i64, fid],
    )?;
    Ok(())
}

pub fn update_form_input(conn: &Connection, id: i64, name: &str, label: &str, field_type: &str, placeholder: &str, default_value: &str, required: bool, folder_id: Option<i64>) -> Result<()> {
    let fid = match folder_id {
        Some(id) => id,
        None => get_or_create_uncategorized(conn)?,
    };
    conn.execute(
        "UPDATE form_inputs SET name = ?1, label = ?2, field_type = ?3, placeholder = ?4, default_value = ?5, required = ?6, folder_id = ?7 WHERE id = ?8",
        params![name, label, field_type, placeholder, default_value, required as i64, fid, id],
    )?;
    Ok(())
}

pub fn delete_form_input(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM form_inputs WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Settings ──

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}
