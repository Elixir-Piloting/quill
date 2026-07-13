use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub struct Snippet {
    pub id: i64,
    pub trigger: String,
    pub expansion: String,
    pub whole_word: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Variable {
    pub id: i64,
    pub name: String,
    pub value: String,
    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormInput {
    pub id: i64,
    pub name: String,
    pub label: String,
    pub placeholder: String,
    pub default_value: String,
    pub required: bool,
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
            placeholder TEXT NOT NULL DEFAULT '',
            default_value TEXT NOT NULL DEFAULT '',
            required INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    let _ = conn.execute_batch(
        "ALTER TABLE snippets ADD COLUMN whole_word INTEGER NOT NULL DEFAULT 1;",
    );
    Ok(conn)
}

// ── Snippets ──

pub fn get_all_snippets(conn: &Connection) -> Result<Vec<Snippet>> {
    let mut stmt =
        conn.prepare("SELECT id, trigger, expansion, whole_word, created_at FROM snippets ORDER BY created_at DESC")?;
    let snippets = stmt
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                trigger: row.get(1)?,
                expansion: row.get(2)?,
                whole_word: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(snippets)
}

pub fn add_snippet(conn: &Connection, trigger: &str, expansion: &str, whole_word: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO snippets (trigger, expansion, whole_word) VALUES (?1, ?2, ?3)",
        params![trigger, expansion, whole_word as i64],
    )?;
    Ok(())
}

pub fn update_snippet(conn: &Connection, id: i64, trigger: &str, expansion: &str, whole_word: bool) -> Result<()> {
    conn.execute(
        "UPDATE snippets SET trigger = ?1, expansion = ?2, whole_word = ?3 WHERE id = ?4",
        params![trigger, expansion, whole_word as i64, id],
    )?;
    Ok(())
}

pub fn delete_snippet(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_all_triggers(conn: &Connection) -> Result<Vec<(i64, String, String, bool)>> {
    let mut stmt = conn.prepare("SELECT id, trigger, expansion, whole_word FROM snippets")?;
    let triggers = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(triggers)
}

// ── Variables ──

pub fn get_all_variables(conn: &Connection) -> Result<Vec<Variable>> {
    let mut stmt =
        conn.prepare("SELECT id, name, value, kind, created_at FROM variables ORDER BY created_at DESC")?;
    let vars = stmt
        .query_map([], |row| {
            Ok(Variable {
                id: row.get(0)?,
                name: row.get(1)?,
                value: row.get(2)?,
                kind: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(vars)
}

pub fn add_variable(conn: &Connection, name: &str, value: &str, kind: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO variables (name, value, kind) VALUES (?1, ?2, ?3)",
        params![name, value, kind],
    )?;
    Ok(())
}

pub fn update_variable(conn: &Connection, id: i64, name: &str, value: &str, kind: &str) -> Result<()> {
    conn.execute(
        "UPDATE variables SET name = ?1, value = ?2, kind = ?3 WHERE id = ?4",
        params![name, value, kind, id],
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
        "SELECT id, name, label, placeholder, default_value, required, created_at
         FROM form_inputs ORDER BY created_at DESC",
    )?;
    let fields = stmt
        .query_map([], |row| {
            Ok(FormInput {
                id: row.get(0)?,
                name: row.get(1)?,
                label: row.get(2)?,
                placeholder: row.get(3)?,
                default_value: row.get(4)?,
                required: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(fields)
}

pub fn add_form_input(conn: &Connection, name: &str, label: &str, placeholder: &str, default_value: &str, required: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO form_inputs (name, label, placeholder, default_value, required) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, label, placeholder, default_value, required as i64],
    )?;
    Ok(())
}

pub fn update_form_input(conn: &Connection, id: i64, name: &str, label: &str, placeholder: &str, default_value: &str, required: bool) -> Result<()> {
    conn.execute(
        "UPDATE form_inputs SET name = ?1, label = ?2, placeholder = ?3, default_value = ?4, required = ?5 WHERE id = ?6",
        params![name, label, placeholder, default_value, required as i64, id],
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
