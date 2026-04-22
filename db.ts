/**
 * SQLite 数据库管理模块
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type TaskStatus = "todo" | "doing" | "done" | "archived";
export type TaskPriority = "urgent" | "high" | "normal" | "low";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  scope: string;
  priority: TaskPriority;
  notes?: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  archived_at?: number;
  blocked_by?: string[];
  deadline?: number;
  remind_before_ms?: number;
  template_id?: string;
  tags?: string[];
  assigned_to?: string;      // 分配给哪个子代理
  parent_session?: string;   // 父会话
}

export interface Tag {
  id: number;
  name: string;
  color?: string;
  created_at: number;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  created_at: number;
  updated_at: number;
  tasks: TemplateTask[];
}

export interface TemplateTask {
  title: string;
  priority: TaskPriority;
  notes?: string;
  order_index: number;
  blocked_by_indexes?: number[];
}

export class KanbanDB {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath.replace(/^~/, os.homedir());
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    this.db.exec(schema);
    
    // 迁移：添加 assigned_to 和 parent_session 字段
    this.migrateToV2_1();
  }

  private migrateToV2_1(): void {
    // 检查是否已经有 assigned_to 字段
    const columns = this.db.pragma("table_info(tasks)") as any[];
    const hasAssignedTo = columns.some((col: any) => col.name === "assigned_to");
    
    if (!hasAssignedTo) {
      this.db.exec(`
        ALTER TABLE tasks ADD COLUMN assigned_to TEXT;
        ALTER TABLE tasks ADD COLUMN parent_session TEXT;
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_session ON tasks(parent_session);
      `);
    }
  }

  // ========================================
  // 任务操作
  // ========================================

  addTask(task: Omit<Task, "id" | "created_at">): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const created_at = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, title, status, scope, priority, notes,
        created_at, blocked_by, deadline, remind_before_ms, template_id,
        assigned_to, parent_session
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.title,
      task.status,
      task.scope,
      task.priority,
      task.notes || null,
      created_at,
      task.blocked_by ? JSON.stringify(task.blocked_by) : null,
      task.deadline || null,
      task.remind_before_ms || null,
      task.template_id || null,
      task.assigned_to || null,
      task.parent_session || null
    );

    // 添加标签
    if (task.tags && task.tags.length > 0) {
      this.setTaskTags(id, task.tags);
    }

    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.rowToTask(row);
  }

  getTasks(filters?: {
    scope?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    tags?: string[];
  }): Task[] {
    let query = "SELECT DISTINCT t.* FROM tasks t";
    const params: any[] = [];

    if (filters?.tags && filters.tags.length > 0) {
      query += `
        INNER JOIN task_tags tt ON t.id = tt.task_id
        INNER JOIN tags tg ON tt.tag_id = tg.id
      `;
    }

    const conditions: string[] = [];
    if (filters?.scope) {
      conditions.push("t.scope = ?");
      params.push(filters.scope);
    }
    if (filters?.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters?.priority) {
      conditions.push("t.priority = ?");
      params.push(filters.priority);
    }
    if (filters?.tags && filters.tags.length > 0) {
      conditions.push(`tg.name IN (${filters.tags.map(() => "?").join(",")})`);
      params.push(...filters.tags);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY t.created_at DESC";

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  updateTask(id: string, updates: Partial<Task>): boolean {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      params.push(updates.title);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      fields.push("priority = ?");
      params.push(updates.priority);
    }
    if (updates.notes !== undefined) {
      fields.push("notes = ?");
      params.push(updates.notes);
    }
    if (updates.started_at !== undefined) {
      fields.push("started_at = ?");
      params.push(updates.started_at);
    }
    if (updates.completed_at !== undefined) {
      fields.push("completed_at = ?");
      params.push(updates.completed_at);
    }
    if (updates.archived_at !== undefined) {
      fields.push("archived_at = ?");
      params.push(updates.archived_at);
    }
    if (updates.blocked_by !== undefined) {
      fields.push("blocked_by = ?");
      params.push(updates.blocked_by ? JSON.stringify(updates.blocked_by) : null);
    }
    if (updates.deadline !== undefined) {
      fields.push("deadline = ?");
      params.push(updates.deadline);
    }
    if (updates.remind_before_ms !== undefined) {
      fields.push("remind_before_ms = ?");
      params.push(updates.remind_before_ms);
    }

    if (fields.length === 0) return false;

    params.push(id);
    const stmt = this.db.prepare(`
      UPDATE tasks SET ${fields.join(", ")} WHERE id = ?
    `);
    const result = stmt.run(...params);

    // 更新标签
    if (updates.tags !== undefined) {
      this.setTaskTags(id, updates.tags);
    }

    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM tasks WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ========================================
  // 标签操作
  // ========================================

  getOrCreateTag(name: string, color?: string): Tag {
    let stmt = this.db.prepare("SELECT * FROM tags WHERE name = ?");
    let tag = stmt.get(name) as any;

    if (!tag) {
      const created_at = Date.now();
      stmt = this.db.prepare("INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)");
      const result = stmt.run(name, color || null, created_at);
      tag = { id: result.lastInsertRowid, name, color, created_at };
    }

    return tag as Tag;
  }

  getTaskTags(taskId: string): Tag[] {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN task_tags tt ON t.id = tt.tag_id
      WHERE tt.task_id = ?
    `);
    return stmt.all(taskId) as Tag[];
  }

  setTaskTags(taskId: string, tagNames: string[]): void {
    // 删除旧标签
    this.db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);

    // 添加新标签
    if (tagNames.length > 0) {
      const stmt = this.db.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)");
      for (const name of tagNames) {
        const tag = this.getOrCreateTag(name);
        stmt.run(taskId, tag.id);
      }
    }
  }

  // ========================================
  // 模板操作
  // ========================================

  saveTemplate(template: Omit<Template, "created_at" | "updated_at">): Template {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO templates (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(template.id, template.name, template.description || null, now, now);

    // 删除旧的模板任务
    this.db.prepare("DELETE FROM template_tasks WHERE template_id = ?").run(template.id);

    // 插入新的模板任务
    const taskStmt = this.db.prepare(`
      INSERT INTO template_tasks (template_id, title, priority, notes, order_index, blocked_by_indexes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const task of template.tasks) {
      taskStmt.run(
        template.id,
        task.title,
        task.priority,
        task.notes || null,
        task.order_index,
        task.blocked_by_indexes ? JSON.stringify(task.blocked_by_indexes) : null
      );
    }

    return this.getTemplate(template.id)!;
  }

  getTemplate(id: string): Template | null {
    const stmt = this.db.prepare("SELECT * FROM templates WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;

    const tasksStmt = this.db.prepare("SELECT * FROM template_tasks WHERE template_id = ? ORDER BY order_index");
    const tasks = tasksStmt.all(id) as any[];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tasks: tasks.map((t) => ({
        title: t.title,
        priority: t.priority,
        notes: t.notes,
        order_index: t.order_index,
        blocked_by_indexes: t.blocked_by_indexes ? JSON.parse(t.blocked_by_indexes) : undefined,
      })),
    };
  }

  getTemplates(): Template[] {
    const stmt = this.db.prepare("SELECT * FROM templates ORDER BY name");
    const rows = stmt.all() as any[];
    return rows.map((row) => this.getTemplate(row.id)!);
  }

  deleteTemplate(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM templates WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ========================================
  // 辅助方法
  // ========================================

  private rowToTask(row: any): Task {
    const tags = this.getTaskTags(row.id);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      scope: row.scope,
      priority: row.priority,
      notes: row.notes,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      archived_at: row.archived_at,
      blocked_by: row.blocked_by ? JSON.parse(row.blocked_by) : undefined,
      deadline: row.deadline,
      remind_before_ms: row.remind_before_ms,
      template_id: row.template_id,
      tags: tags.map((t) => t.name),
      assigned_to: row.assigned_to,
      parent_session: row.parent_session,
    };
  }

  close(): void {
    this.db.close();
  }
}
