-- 國考題庫後端 D1 schema

-- 匿名訪客計數（沿用 transparent-nursing 做法：只存日期+計數與雜湊去重，不記錄原始 IP/UA）
CREATE TABLE IF NOT EXISTS daily (
  day   TEXT PRIMARY KEY,          -- Asia/Taipei YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seen (
  h     TEXT PRIMARY KEY,          -- SHA256(SALT|IP|裝置桶|day)
  ipday TEXT NOT NULL,             -- SHA256(SALT|IP|day)
  day   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seen_day ON seen(day);
CREATE INDEX IF NOT EXISTS idx_seen_ipday ON seen(ipday);

-- 每題作答統計（錯誤率排名 + 全站已作答題數）
CREATE TABLE IF NOT EXISTS qstat (
  qid      TEXT PRIMARY KEY,       -- prof|examCode-subNo.json|no
  prof     TEXT NOT NULL,
  subject  TEXT NOT NULL,          -- 科目短名（供篩選/顯示）
  attempts INTEGER NOT NULL DEFAULT 0,
  wrong    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qstat_prof ON qstat(prof);
CREATE INDEX IF NOT EXISTS idx_qstat_subject ON qstat(subject);

-- 全站計數（answered_total = 累計已作答題數）
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL DEFAULT 0
);
