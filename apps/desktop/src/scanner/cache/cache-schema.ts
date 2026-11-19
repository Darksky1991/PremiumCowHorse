/**
 * 缓存库 index.db 的表结构。这是可随时删除重建的缓存：不做迁移，
 * 结构变化时递增 CACHE_VERSION，打开时发现 user_version 不符就删表重建。
 */
export const CACHE_VERSION = 3

export const DROP_SQL = `
DROP TABLE IF EXISTS entries_fts;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS dirs;
`

export const CREATE_SQL = `
CREATE TABLE dirs (
  uri         TEXT PRIMARY KEY,
  parent_uri  TEXT,
  dir_mtime   REAL,
  listed_at   INTEGER,
  checked_at  INTEGER,
  state       TEXT NOT NULL,
  error_code  TEXT,
  visited_at  INTEGER,
  visit_score REAL NOT NULL DEFAULT 0,
  -- URI 中 / 的个数（驱动器根末尾的 / 不计），供队列索引按层数过滤与排序
  depth       INTEGER GENERATED ALWAYS AS (length(uri) - length(replace(uri, '/', '')) - (substr(uri, -1) = '/')) VIRTUAL
);
CREATE INDEX dirs_parent ON dirs (parent_uri);
-- 后台缓存队列（Cache.nextUnlisted / oldestChecked）。checked_at 为 NULL = 从未尝试读取；两个部分索引
-- 互不重叠，覆盖整个队列顺序（范围大时按索引顺序扫描 + LIMIT，30 万行下整卷查询不到 1ms）
CREATE INDEX dirs_unlisted ON dirs (depth, uri) WHERE checked_at IS NULL;
CREATE INDEX dirs_checked ON dirs (checked_at, uri, depth) WHERE checked_at IS NOT NULL;

-- 需要整数 rowid 供 FTS5 external content 使用，所以不用 WITHOUT ROWID
CREATE TABLE entries (
  dir_uri TEXT NOT NULL REFERENCES dirs(uri) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL,
  target  TEXT,
  size    INTEGER NOT NULL,
  mtime   REAL NOT NULL,
  hidden  INTEGER NOT NULL,
  PRIMARY KEY (dir_uri, name)
);

CREATE VIRTUAL TABLE entries_fts USING fts5(name, content='entries', content_rowid='rowid', tokenize='trigram');

CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, name) VALUES (new.rowid, new.name);
END;
CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;
CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO entries_fts(rowid, name) VALUES (new.rowid, new.name);
END;
`
