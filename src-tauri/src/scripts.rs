use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const DEFAULT_TIMEOUT_MS: u32 = 5000;
pub const MIN_TIMEOUT_MS: u32 = 500;
pub const MAX_TIMEOUT_MS: u32 = 30_000;
const MAX_OUTPUT_BYTES: usize = 10 * 1024;

fn default_timeout_ms() -> u32 {
    DEFAULT_TIMEOUT_MS
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptVariable {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: ScriptSource,
    pub shell: ShellKind,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default = "default_true")]
    pub trim_output: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "source")]
pub enum ScriptSource {
    #[serde(rename = "inline")]
    Inline { command: String },
    #[serde(rename = "file")]
    File {
        interpreter: String,
        path: PathBuf,
        extra_args: Vec<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "shell")]
pub enum ShellKind {
    #[serde(rename = "powershell")]
    PowerShell,
    #[serde(rename = "cmd")]
    Cmd,
    #[serde(rename = "wsl")]
    Wsl,
    #[serde(rename = "custom")]
    Custom { executable: String, arg_flag: String },
}

/// Context passed to a script via environment variables. `variables` holds
/// the variables already resolved earlier in the current expansion (in
/// dependency order).
#[derive(Debug, Clone)]
pub struct ScriptContext {
    pub trigger: String,
    pub app: Option<String>,
    pub variables: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub enum ScriptError {
    Timeout,
    NonZeroExit { code: i32, stderr_snippet: String },
    SpawnFailed { reason: String },
    IoError(String),
    InvalidConfig(String),
}

impl ScriptError {
    pub fn user_message(&self) -> String {
        match self {
            ScriptError::Timeout => {
                "Script timed out (took longer than the configured limit)".into()
            }
            ScriptError::NonZeroExit {
                code,
                stderr_snippet,
            } => {
                if stderr_snippet.is_empty() {
                    format!("Script exited with code {code}")
                } else {
                    format!("Script exited with code {code}: {stderr_snippet}")
                }
            }
            ScriptError::SpawnFailed { reason } => format!(
                "Couldn't start script ({reason}) — is the shell/interpreter installed?"
            ),
            ScriptError::IoError(reason) => format!("Script failed: {reason}"),
            ScriptError::InvalidConfig(msg) => format!("Invalid script configuration: {msg}"),
        }
    }
}

pub fn parse_config(value: &str) -> Result<ScriptVariable, ScriptError> {
    serde_json::from_str(value).map_err(|e| ScriptError::InvalidConfig(e.to_string()))
}

fn runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_io()
            .enable_time()
            .build()
            .expect("failed to build tokio runtime for scripts")
    })
}

/// Synchronous wrapper used from background injection threads so the
/// keyboard hook listener never blocks on script execution.
pub fn run_script_blocking(config: &ScriptVariable, ctx: &ScriptContext) -> Result<String, ScriptError> {
    runtime().block_on(run_script(config, ctx))
}

pub async fn run_script(config: &ScriptVariable, ctx: &ScriptContext) -> Result<String, ScriptError> {
    let timeout_ms = config.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    let timeout = Duration::from_millis(u64::from(timeout_ms));

    let mut cmd = build_command(config)?;
    apply_env(&mut cmd, ctx);

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW — avoid flashing a console window on execution
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| ScriptError::SpawnFailed {
            reason: e.to_string(),
        })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let status = tokio::select! {
        status = child.wait() => status.map_err(|e| ScriptError::IoError(e.to_string()))?,
        _ = tokio::time::sleep(timeout) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(ScriptError::Timeout);
        }
    };

    let mut out_buf = Vec::new();
    let mut err_buf = Vec::new();
    if let Some(mut so) = stdout {
        let _ = tokio::io::copy(&mut so, &mut out_buf).await;
    }
    if let Some(mut se) = stderr {
        let _ = tokio::io::copy(&mut se, &mut err_buf).await;
    }

    if !status.success() {
        let code = status.code().unwrap_or(-1);
        let stderr_text = String::from_utf8_lossy(&err_buf).to_string();
        let first_line = stderr_text.lines().next().unwrap_or("").to_string();
        let snippet = truncate_chars(&first_line, 100);
        eprintln!("[quill] script exited nonzero (code={code}); full stderr:\n{stderr_text}");
        return Err(ScriptError::NonZeroExit {
            code,
            stderr_snippet: snippet,
        });
    }

    let mut stdout_text = String::from_utf8_lossy(&out_buf).to_string();
    if stdout_text.len() > MAX_OUTPUT_BYTES {
        let mut end = MAX_OUTPUT_BYTES;
        while !stdout_text.is_char_boundary(end) {
            end -= 1;
        }
        stdout_text.truncate(end);
        stdout_text.push_str("\n[output truncated — first 10KB shown]");
    }
    if config.trim_output {
        stdout_text = stdout_text.trim_end().to_string();
    }
    Ok(stdout_text)
}

fn build_command(config: &ScriptVariable) -> Result<tokio::process::Command, ScriptError> {
    let mut cmd = match (&config.source, &config.shell) {
        (ScriptSource::Inline { command }, shell) => {
            let mut c = match shell {
                ShellKind::PowerShell => tokio::process::Command::new("powershell"),
                ShellKind::Cmd => tokio::process::Command::new("cmd"),
                ShellKind::Wsl => tokio::process::Command::new("wsl"),
                ShellKind::Custom { executable, .. } => tokio::process::Command::new(executable),
            };
            match shell {
                ShellKind::PowerShell => {
                    c.arg("-NoProfile").arg("-NonInteractive").arg("-Command").arg(command);
                }
                ShellKind::Cmd => {
                    c.arg("/C").arg(command);
                }
                ShellKind::Wsl => {
                    c.arg("bash").arg("-c").arg(command);
                }
                ShellKind::Custom { arg_flag, .. } => {
                    c.arg(arg_flag).arg(command);
                }
            }
            c
        }
        (ScriptSource::File {
            interpreter,
            path,
            extra_args,
        }, _) => {
            if interpreter.trim().is_empty() {
                return Err(ScriptError::InvalidConfig(
                    "interpreter is required for a script file".into(),
                ));
            }
            let mut c = tokio::process::Command::new(interpreter);
            c.arg(path);
            c.args(extra_args);
            c
        }
    };
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::null());
    Ok(cmd)
}

fn apply_env(cmd: &mut tokio::process::Command, ctx: &ScriptContext) {
    cmd.env("QUILL_TRIGGER", &ctx.trigger);
    if let Some(app) = &ctx.app {
        cmd.env("QUILL_APP", app);
    }
    let context = serde_json::json!({
        "trigger": ctx.trigger,
        "app": ctx.app,
        "variables": ctx.variables,
    });
    cmd.env("QUILL_CONTEXT", context.to_string());
    for (name, value) in &ctx.variables {
        cmd.env(env_var_name(name), value);
    }
}

fn env_var_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 10);
    out.push_str("QUILL_VAR_");
    for c in name.to_uppercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    out
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// True if `wsl.exe` is reachable on PATH (or in System32). Checked once at
/// startup and cached by the caller.
pub fn wsl_available() -> bool {
    fn exists_in(dir: &std::path::Path) -> bool {
        dir.join("wsl.exe").is_file()
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            if exists_in(&dir) {
                return true;
            }
        }
    }
    #[cfg(windows)]
    if let Some(sysroot) = std::env::var_os("SystemRoot") {
        let dir = std::path::Path::new(&sysroot).join("System32");
        if exists_in(&dir) {
            return true;
        }
    }
    false
}
