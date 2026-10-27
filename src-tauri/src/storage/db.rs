//! Answer history in local SQLite. Text only, never images (AGENTS.md rule 4).

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::{AppError, AppResult};

const SCHEMA_VERSION: i32 = 1;
pub const MAX_PAGE: u32 = 100;

/// Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    /// Unix time in milliseconds.
    pub created_at: i64,
    pub provider: String,
    pub model: String,
    pub target: String,
    /// The follow-up question, or `None` for the first answer of a screenshot.
    pub prompt: Option<String>,
    pub answer: String,
}

pub struct NewEntry<'a> {
    pub provider: &'a str,
    pub model: &'a str,
    pub target: &'a str,
    pub prompt: Option<&'a str>,
    pub answer: &'a str,
}

pub struct HistoryDb {
    conn: Mutex<Option<Connection>>,
}

fn db_error(err: impl std::fmt::Display) -> AppError {
    AppError::Storage(err.to_string())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // Deleted history should not linger in free pages.
    conn.pragma_update(None, "secure_delete", true)?;
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at INTEGER NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                target TEXT NOT NULL,
                prompt TEXT,
                answer TEXT NOT NULL
            );",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

impl HistoryDb {
    /// Opens (or creates) the database. A failure disables history instead of
    /// stopping the app.
    pub fn open(path: &Path) -> Self {
        let conn = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .map_err(db_error)
            .and_then(|()| Connection::open(path).map_err(db_error))
            .and_then(|conn| migrate(&conn).map(|()| conn).map_err(db_error));
        match conn {
            Ok(conn) => Self {
                conn: Mutex::new(Some(conn)),
            },
            Err(err) => {
                tracing::error!("history database unavailable: {err}");
                Self {
                    conn: Mutex::new(None),
                }
            }
        }
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        Self {
            conn: Mutex::new(Some(conn)),
        }
    }

    fn with<T>(&self, run: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> AppResult<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("history lock poisoned".into()))?;
        let conn = guard
            .as_ref()
            .ok_or_else(|| AppError::Storage("history database unavailable".into()))?;
        run(conn).map_err(db_error)
    }

    pub fn insert(&self, entry: &NewEntry<'_>) -> AppResult<i64> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO history (created_at, provider, model, target, prompt, answer)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    now_ms(),
                    entry.provider,
                    entry.model,
                    entry.target,
                    entry.prompt,
                    entry.answer
                ],
            )?;
            Ok(conn.last_insert_rowid())
        })
    }

    /// Newest first. `before` is the last id of the previous page.
    pub fn list(&self, limit: u32, before: Option<i64>) -> AppResult<Vec<HistoryEntry>> {
        let limit = limit.clamp(1, MAX_PAGE);
        self.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT id, created_at, provider, model, target, prompt, answer
                 FROM history WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
            )?;
            let rows = statement.query_map(params![before.unwrap_or(i64::MAX), limit], |row| {
                Ok(HistoryEntry {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    provider: row.get(2)?,
                    model: row.get(3)?,
                    target: row.get(4)?,
                    prompt: row.get(5)?,
                    answer: row.get(6)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn delete(&self, id: i64) -> AppResult<bool> {
        self.with(|conn| {
            conn.execute("DELETE FROM history WHERE id = ?1", params![id])
                .map(|changed| changed > 0)
        })
    }

    pub fn clear(&self) -> AppResult<usize> {
        self.with(|conn| {
            let removed = conn.execute("DELETE FROM history", [])?;
            // Shrink the file so nothing is left behind on disk.
            conn.execute_batch("VACUUM")?;
            Ok(removed)
        })
    }

    #[cfg(test)]
    fn schema_version(&self) -> i32 {
        self.with(|conn| conn.query_row("PRAGMA user_version", [], |row| row.get(0)))
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(answer: &str) -> NewEntry<'_> {
        NewEntry {
            provider: "anthropic",
            model: "claude-sonnet-5-5",
            target: "screen",
            prompt: None,
            answer,
        }
    }

    #[test]
    fn migrates_to_the_current_schema() {
        assert_eq!(HistoryDb::in_memory().schema_version(), SCHEMA_VERSION);
    }

    #[test]
    fn inserts_and_lists_newest_first_with_paging() {
        let db = HistoryDb::in_memory();
        for i in 0..5 {
            db.insert(&entry(&format!("answer {i}"))).unwrap();
        }
        let follow_up = NewEntry {
            prompt: Some("why?"),
            ..entry("because")
        };
        db.insert(&follow_up).unwrap();

        let page = db.list(3, None).unwrap();
        assert_eq!(page.len(), 3);
        assert_eq!(page[0].answer, "because");
        assert_eq!(page[0].prompt.as_deref(), Some("why?"));
        assert!(page[0].created_at > 0);

        let next = db.list(3, Some(page[2].id)).unwrap();
        assert_eq!(
            next.iter().map(|e| e.answer.as_str()).collect::<Vec<_>>(),
            vec!["answer 2", "answer 1", "answer 0"]
        );
    }

    #[test]
    fn deletes_and_clears() {
        let db = HistoryDb::in_memory();
        let id = db.insert(&entry("one")).unwrap();
        db.insert(&entry("two")).unwrap();

        assert!(db.delete(id).unwrap());
        assert!(!db.delete(id).unwrap());
        assert_eq!(db.list(10, None).unwrap().len(), 1);

        assert_eq!(db.clear().unwrap(), 1);
        assert!(db.list(10, None).unwrap().is_empty());
    }
}
