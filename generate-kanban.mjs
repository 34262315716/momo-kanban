import Database from 'better-sqlite3';
import fs from 'node:fs';

const db = new Database('/home/zhangdixuan/.openclaw/data/kanban.db');
const tasks = db.prepare('SELECT * FROM tasks WHERE scope = ?').all('kanban-upgrade');

const priorityEmoji = {
  urgent: '🔴',
  high: '🟡',
  normal: '⚪',
  low: '🔵',
};

const statusColumns = {
  todo: tasks.filter(t => t.status === 'todo'),
  doing: tasks.filter(t => t.status === 'doing'),
  done: tasks.filter(t => t.status === 'done'),
  archived: tasks.filter(t => t.status === 'archived'),
};

const stats = {
  total: tasks.length,
  todo: statusColumns.todo.length,
  doing: statusColumns.doing.length,
  done: statusColumns.done.length,
  archived: statusColumns.archived.length,
  urgent: tasks.filter(t => t.priority === 'urgent').length,
  high: tasks.filter(t => t.priority === 'high').length,
  normal: tasks.filter(t => t.priority === 'normal').length,
  low: tasks.filter(t => t.priority === 'low').length,
};

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function renderTask(task) {
  return `
    <div class="task task-${task.priority}">
      <div class="task-header">
        <span class="task-priority">${priorityEmoji[task.priority] || '⚪'}</span>
        <span class="task-title">${escapeHtml(task.title)}</span>
      </div>
      ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ''}
      ${task.blocked_by ? `<div class="task-blocked">🔒 被阻塞</div>` : ''}
      <div class="task-id">${task.id}</div>
    </div>
  `;
}

const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>陌陌工作看板 - kanban-upgrade</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .header h1 {
      font-size: 28px;
      color: #333;
      margin-bottom: 16px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .stat-card {
      background: #f7fafc;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      font-size: 14px;
      color: #718096;
      margin-top: 4px;
    }
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }
    .column {
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .column-header {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .column-count {
      background: #667eea;
      color: white;
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 14px;
    }
    .task {
      background: #f7fafc;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #cbd5e0;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .task:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }
    .task-urgent { border-left-color: #f56565; }
    .task-high { border-left-color: #ed8936; }
    .task-normal { border-left-color: #48bb78; }
    .task-low { border-left-color: #4299e1; }
    .task-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .task-priority {
      font-size: 16px;
    }
    .task-title {
      font-weight: 600;
      color: #2d3748;
      flex: 1;
    }
    .task-notes {
      font-size: 13px;
      color: #718096;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .task-blocked {
      color: #e53e3e;
      font-size: 12px;
      font-weight: 600;
    }
    .task-id {
      font-size: 11px;
      color: #a0aec0;
      margin-top: 8px;
    }
    .empty-column {
      text-align: center;
      color: #a0aec0;
      padding: 40px 20px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ 陌陌工作看板</h1>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">总任务</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.todo}</div>
          <div class="stat-label">待办</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.doing}</div>
          <div class="stat-label">进行中</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.done}</div>
          <div class="stat-label">已完成</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.archived}</div>
          <div class="stat-label">已归档</div>
        </div>
      </div>
    </div>
    
    <div class="board">
      <div class="column">
        <div class="column-header">
          <span>📋 待办 (TODO)</span>
          <span class="column-count">${statusColumns.todo.length}</span>
        </div>
        ${statusColumns.todo.length > 0 
          ? statusColumns.todo.map(renderTask).join('') 
          : '<div class="empty-column">暂无任务</div>'}
      </div>
      
      <div class="column">
        <div class="column-header">
          <span>🔵 进行中 (DOING)</span>
          <span class="column-count">${statusColumns.doing.length}</span>
        </div>
        ${statusColumns.doing.length > 0 
          ? statusColumns.doing.map(renderTask).join('') 
          : '<div class="empty-column">暂无任务</div>'}
      </div>
      
      <div class="column">
        <div class="column-header">
          <span>✅ 已完成 (DONE)</span>
          <span class="column-count">${statusColumns.done.length}</span>
        </div>
        ${statusColumns.done.length > 0 
          ? statusColumns.done.map(renderTask).join('') 
          : '<div class="empty-column">暂无任务</div>'}
      </div>
      
      <div class="column">
        <div class="column-header">
          <span>📦 已归档 (ARCHIVED)</span>
          <span class="column-count">${statusColumns.archived.length}</span>
        </div>
        ${statusColumns.archived.length > 0 
          ? statusColumns.archived.map(renderTask).join('') 
          : '<div class="empty-column">暂无任务</div>'}
      </div>
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync('/tmp/kanban-view.html', html);
console.log('✅ 看板视图已生成: /tmp/kanban-view.html');
