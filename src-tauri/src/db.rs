use rusqlite::{params, Connection, Result};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct Snippet {
    pub id: i64,
    pub trigger: String,
    pub expansion: String,
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

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger TEXT NOT NULL UNIQUE,
            expansion TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS variables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'text',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    Ok(conn)
}

// ── Snippets ──

pub fn get_all_snippets(conn: &Connection) -> Result<Vec<Snippet>> {
    let mut stmt =
        conn.prepare("SELECT id, trigger, expansion, created_at FROM snippets ORDER BY created_at DESC")?;
    let snippets = stmt
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                trigger: row.get(1)?,
                expansion: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(snippets)
}

pub fn add_snippet(conn: &Connection, trigger: &str, expansion: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO snippets (trigger, expansion) VALUES (?1, ?2)",
        params![trigger, expansion],
    )?;
    Ok(())
}

pub fn update_snippet(conn: &Connection, id: i64, trigger: &str, expansion: &str) -> Result<()> {
    conn.execute(
        "UPDATE snippets SET trigger = ?1, expansion = ?2 WHERE id = ?3",
        params![trigger, expansion, id],
    )?;
    Ok(())
}

pub fn delete_snippet(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_all_triggers(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT trigger, expansion FROM snippets")?;
    let triggers = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
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
         INSERT OR IGNORE INTO variables (name, value, kind) VALUES ('clipboard', '', 'clipboard');",
    )?;
    Ok(())
}
