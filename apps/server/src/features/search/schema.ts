export const SCHEMA_VERSION = 1;

/**
 * hpt.sqlite is a build artifact: never migrated, never written at runtime.
 * Citable passages and map passages live in separate tables on purpose. Separate FTS tables keep BM25 statistics
 * for putusan free of AI-written wiki pages, and a map row can never be returned as evidence.
 */
export const SCHEMA_SQL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE notes (
  rowid        INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  collection   TEXT NOT NULL CHECK (collection IN ('putusan','sources','concepts','entities','quran')),
  title        TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  folder       TEXT,
  year         INTEGER,
  number       TEXT,
  published_in TEXT
) STRICT;

CREATE TABLE passages (
  rowid         INTEGER PRIMARY KEY,
  id            TEXT NOT NULL UNIQUE,
  note_rowid    INTEGER NOT NULL REFERENCES notes(rowid),
  ordinal       INTEGER NOT NULL,
  section       TEXT,
  source_type   TEXT NOT NULL CHECK (source_type IN ('putusan','fatwa','hpt','penjelasan','tanya_jawab','opinion')),
  parent        TEXT,
  locator       TEXT NOT NULL DEFAULT '{}',
  superseded_by TEXT,
  supersedes    TEXT,
  text          TEXT NOT NULL,
  text_hash     TEXT NOT NULL,
  word_count    INTEGER NOT NULL,
  UNIQUE (note_rowid, ordinal)
) STRICT;

CREATE TABLE map_passages (
  rowid      INTEGER PRIMARY KEY,
  note_rowid INTEGER NOT NULL REFERENCES notes(rowid),
  ordinal    INTEGER NOT NULL,
  section    TEXT,
  text       TEXT NOT NULL,
  UNIQUE (note_rowid, ordinal)
) STRICT;

CREATE TABLE map_links (
  map_rowid  INTEGER NOT NULL REFERENCES map_passages(rowid),
  note_rowid INTEGER NOT NULL REFERENCES notes(rowid),
  position   INTEGER NOT NULL,
  PRIMARY KEY (map_rowid, note_rowid)
) STRICT, WITHOUT ROWID;

CREATE VIRTUAL TABLE putusan_fts USING fts5(title, section, body, content = '', tokenize = 'unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE map_fts USING fts5(title, section, body, content = '', tokenize = 'unicode61 remove_diacritics 2');
`;
