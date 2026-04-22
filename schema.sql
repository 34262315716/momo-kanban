-- 陌陌看板 SQLite Schema
-- 支持所有增强功能：优先级、标签、备注、时间追踪、模板、归档

-- ========================================
-- 主任务表
-- ========================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('todo', 'doing', 'done', 'archived')),
  scope TEXT NOT NULL DEFAULT 'main',
  
  -- 优先级
  priority TEXT CHECK(priority IN ('urgent', 'high', 'normal', 'low')) DEFAULT 'normal',
  
  -- 备注
  notes TEXT,
  
  -- 时间追踪
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  archived_at INTEGER,
  
  -- 依赖关系（JSON array of task IDs）
  blocked_by TEXT,
  
  -- 提醒
  deadline INTEGER,
  remind_before_ms INTEGER,
  
  -- 模板来源
  template_id TEXT,
  
  -- 子代理分配
  assigned_to TEXT,        -- 分配给哪个子代理（session_key）
  parent_session TEXT,     -- 父会话 session_key
  
  -- 索引字段
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
);

-- ========================================
-- 标签表
-- ========================================
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL
);

-- ========================================
-- 任务-标签关联表
-- ========================================
CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, tag_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- ========================================
-- 模板表
-- ========================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ========================================
-- 模板任务表
-- ========================================
CREATE TABLE IF NOT EXISTS template_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT CHECK(priority IN ('urgent', 'high', 'normal', 'low')) DEFAULT 'normal',
  notes TEXT,
  order_index INTEGER NOT NULL,
  blocked_by_indexes TEXT, -- JSON array of order_index values
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- ========================================
-- 看板元数据表
-- ========================================
CREATE TABLE IF NOT EXISTS board_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ========================================
-- 索引
-- ========================================
CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks(scope);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_session ON tasks(parent_session);
CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_template_tasks_template_id ON template_tasks(template_id);

-- ========================================
-- 初始化元数据
-- ========================================
INSERT OR IGNORE INTO board_meta (key, value) VALUES ('board_name', '陌陌工作看板');
INSERT OR IGNORE INTO board_meta (key, value) VALUES ('version', '2.0.0');
INSERT OR IGNORE INTO board_meta (key, value) VALUES ('created_at', strftime('%s', 'now') * 1000);
