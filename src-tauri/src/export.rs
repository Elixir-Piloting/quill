use std::fs;

use serde::{Deserialize, Serialize};

use crate::db;

const EXPORT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub version: u32,
    pub snippets: Vec<ExportedSnippet>,
    pub variables: Vec<ExportedVariable>,
    pub form_inputs: Vec<ExportedFormInput>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportedSnippet {
    pub trigger: String,
    pub expansion: String,
    pub whole_word: bool,
    pub app_scope: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportedVariable {
    pub name: String,
    pub value: String,
    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportedFormInput {
    pub name: String,
    pub label: String,
    pub field_type: String,
    pub placeholder: String,
    pub default_value: String,
    pub required: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ImportPreview {
    pub snippet_count: usize,
    pub variable_count: usize,
    pub form_input_count: usize,
    pub version: u32,
    pub is_version_future: bool,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub snippets_imported: usize,
    pub variables_imported: usize,
    pub form_inputs_imported: usize,
    pub duplicates_skipped: usize,
}

pub fn build_export(conn: &rusqlite::Connection) -> Result<String, String> {
    let snippets = db::get_all_snippets(conn).map_err(|e| e.to_string())?;
    let variables = db::get_all_variables(conn).map_err(|e| e.to_string())?;
    let form_inputs = db::get_all_form_inputs(conn).map_err(|e| e.to_string())?;

    let data = ExportData {
        version: EXPORT_VERSION,
        snippets: snippets
            .into_iter()
            .map(|s| ExportedSnippet {
                trigger: s.trigger,
                expansion: s.expansion,
                whole_word: s.whole_word,
                app_scope: s.app_scope,
                created_at: s.created_at,
            })
            .collect(),
        variables: variables
            .into_iter()
            .map(|v| ExportedVariable {
                name: v.name,
                value: v.value,
                kind: v.kind,
                created_at: v.created_at,
            })
            .collect(),
        form_inputs: form_inputs
            .into_iter()
            .map(|f| ExportedFormInput {
                name: f.name,
                label: f.label,
                field_type: f.field_type,
                placeholder: f.placeholder,
                default_value: f.default_value,
                required: f.required,
                created_at: f.created_at,
            })
            .collect(),
    };

    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())
}

pub fn write_export_json(path: &str, json: &str) -> Result<(), String> {
    fs::write(path, json).map_err(|e| format!("Failed to write file: {}", e))
}

pub fn read_import_json(path: &str) -> Result<String, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(content)
}

pub fn validate_import(json: &str) -> Result<ImportPreview, String> {
    let data: ExportData = serde_json::from_str(json)
        .map_err(|_| "This file couldn't be read as a valid Quill export.".to_string())?;

    Ok(ImportPreview {
        snippet_count: data.snippets.len(),
        variable_count: data.variables.len(),
        form_input_count: data.form_inputs.len(),
        version: data.version,
        is_version_future: data.version > EXPORT_VERSION,
    })
}

pub fn execute_import(
    conn: &rusqlite::Connection,
    json: &str,
    mode: &str,
) -> Result<ImportResult, String> {
    let data: ExportData =
        serde_json::from_str(json).map_err(|_| "Import data is no longer valid.".to_string())?;

    if mode == "replace" {
        conn.execute_batch(
            "DELETE FROM snippets; DELETE FROM variables; DELETE FROM form_inputs;",
        )
        .map_err(|e| e.to_string())?;
    }

    let mut duplicates_skipped = 0;
    let mut snippets_imported = 0;
    let mut variables_imported = 0;
    let mut form_inputs_imported = 0;

    for s in &data.snippets {
        match db::add_snippet(conn, &s.trigger, &s.expansion, s.whole_word, &s.app_scope) {
            Ok(_) => snippets_imported += 1,
            Err(e) => {
                if e.to_string().contains("UNIQUE") {
                    duplicates_skipped += 1;
                } else {
                    return Err(format!("Failed to import snippet '{}': {}", s.trigger, e));
                }
            }
        }
    }

    for v in &data.variables {
        match db::add_variable(conn, &v.name, &v.value, &v.kind) {
            Ok(_) => variables_imported += 1,
            Err(e) => {
                if e.to_string().contains("UNIQUE") {
                    duplicates_skipped += 1;
                } else {
                    return Err(format!("Failed to import variable '{}': {}", v.name, e));
                }
            }
        }
    }

    for f in &data.form_inputs {
        match db::add_form_input(
            conn,
            &f.name,
            &f.label,
            &f.field_type,
            &f.placeholder,
            &f.default_value,
            f.required,
        ) {
            Ok(_) => form_inputs_imported += 1,
            Err(e) => {
                if e.to_string().contains("UNIQUE") {
                    duplicates_skipped += 1;
                } else {
                    return Err(format!("Failed to import form input '{}': {}", f.name, e));
                }
            }
        }
    }

    Ok(ImportResult {
        snippets_imported,
        variables_imported,
        form_inputs_imported,
        duplicates_skipped,
    })
}
