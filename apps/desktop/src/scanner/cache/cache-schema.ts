/**
 * 缓存库 index.db 的表结构。这是可随时删除重建的缓存：不做迁移，
 * 结构变化时递增 CACHE_VERSION，打开时发现 user_version 不符就删表重建。
 */
export const CACHE_VERSION = 5

export const DROP_SQL = `
DROP TABLE IF EXISTS entries_fts;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS dirs;
DROP TABLE IF EXISTS sqlite_sequence;
`

export const CREATE_SQL = `
-- 目录用整数编号（id）被 entries 与子目录引用：entries 的每一行不再重复保存长 URI（日文长路径下
-- 平均 200 字符，entries 与其主键索引各省一份）。AUTOINCREMENT：编号不复用，目录删除后以同一 URI
-- 重建会得到新编号，残留的 parent_id 也不会指向别的目录
CREATE TABLE dirs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uri         TEXT NOT NULL UNIQUE,
  parent_id   INTEGER,
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
CREATE INDEX dirs_parent ON dirs (parent_id);
-- 后台缓存队列（Cache.nextUnlisted / oldestChecked）。checked_at 为 NULL = 从未尝试读取；两个部分索引
-- 互不重叠，覆盖整个队列顺序（范围大时按索引顺序扫描 + LIMIT）。实测（30 万行合成数据 C:/r*/d*/e*，limit 20）：
-- 整卷、层数不限约 0.2–0.3ms（内存库 / 文件库）；整卷且层数上限很小（maxDepth 1，符合条件的行在 checked_at
-- 顺序中很稀疏）时 oldestChecked 要扫很多行：内存库约 15ms、文件库约 25–45ms，由后台队列的批量候选平摊
CREATE INDEX dirs_unlisted ON dirs (depth, uri) WHERE checked_at IS NULL;
CREATE INDEX dirs_checked ON dirs (checked_at, uri, depth) WHERE checked_at IS NOT NULL;
-- 热点目录（Cache.hot）：只有访问过的目录（visit_score > 0），覆盖查询所需的列，不扫描整张表
CREATE INDEX dirs_hot ON dirs (visit_score, visited_at, uri) WHERE visit_score > 0;

-- 需要整数 rowid 供 FTS5 external content 使用，所以不用 WITHOUT ROWID
CREATE TABLE entries (
  dir_id  INTEGER NOT NULL REFERENCES dirs(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL,
  target  TEXT,
  size    INTEGER NOT NULL,
  mtime   REAL NOT NULL,
  hidden  INTEGER NOT NULL,
  PRIMARY KEY (dir_id, name)
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
