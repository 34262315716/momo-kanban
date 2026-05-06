#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('/home/zhangdixuan/.openclaw/data/kanban.db');
const SCOPE = 'main';

function addTask(title, opts = {}) {
  const { priority = 'normal', notes = '', tags = [], blocked_by = [] } = opts;
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  db.prepare(`INSERT INTO tasks (id, title, status, scope, priority, notes, created_at, blocked_by)
    VALUES (?, ?, 'todo', ?, ?, ?, ?, ?)`).run(id, title, SCOPE, priority, notes, now, blocked_by.length ? JSON.stringify(blocked_by) : null);
  
  // Handle tags
  for (const tagName of tags) {
    let tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
    if (!tagRow) {
      db.prepare('INSERT INTO tags (name, created_at) VALUES (?, ?)').run(tagName, now);
      tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
    }
    db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(id, tagRow.id);
  }
  return id;
}

function listTasks(opts = {}) {
  const { scope = SCOPE, status, showAll } = opts;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];
  if (!showAll) { sql += ' AND scope = ?'; params.push(scope); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function updateTask(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = Object.values(fields);
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...vals, id);
}

function deleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

const cmd = process.argv[2];
switch (cmd) {
  case 'add':
    const title = process.argv[3];
    if (!title) { console.log('Usage: kanban-cli.js add <title> [priority] [notes]'); break; }
    const id = addTask(title, { priority: process.argv[4] || 'normal', notes: process.argv[5] || '' });
    console.log(`✅ 已添加: ${title} [${id}]`);
    break;
  case 'list':
    const tasks = listTasks({ showAll: process.argv.includes('--all') });
    const emoji = { urgent: '🔴', high: '🟡', normal: '⚪', low: '🔵' };
    for (const t of tasks) {
      console.log(`${emoji[t.priority] || '⚪'} [${t.status}] ${t.title} (${t.id})`);
      if (t.notes) console.log(`   ${t.notes}`);
    }
    console.log(`\n共 ${tasks.length} 个任务`);
    break;
  case 'done':
    updateTask(process.argv[3], { status: 'done', completed_at: Date.now() });
    console.log(`✅ 已完成: ${process.argv[3]}`);
    break;
  case 'doing':
    updateTask(process.argv[3], { status: 'doing', started_at: Date.now() });
    console.log(`🔄 开始: ${process.argv[3]}`);
    break;
  case 'delete':
    deleteTask(process.argv[3]);
    console.log(`🗑️ 已删除: ${process.argv[3]}`);
    break;
  default:
    console.log('Commands: add, list, done, doing, delete');
}

db.close();
