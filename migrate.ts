/**
 * 数据迁移工具：JSON → SQLite
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { KanbanDB, Task } from "./db.js";

interface OldKanbanData {
  tasks: Array<{
    id: string;
    title: string;
    status: "todo" | "doing" | "done";
    scope: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    blockedBy?: string[];
  }>;
  boardName: string;
  lastUpdated: string;
  currentTaskId?: string;
}

export function migrateFromJSON(jsonPath: string, dbPath: string): void {
  const resolvedJsonPath = jsonPath.replace(/^~/, os.homedir());
  const resolvedDbPath = dbPath.replace(/^~/, os.homedir());

  console.log(`[migrate] 开始迁移: ${resolvedJsonPath} → ${resolvedDbPath}`);

  // 读取旧数据
  if (!fs.existsSync(resolvedJsonPath)) {
    console.log("[migrate] JSON 文件不存在，跳过迁移");
    return;
  }

  const oldData: OldKanbanData = JSON.parse(fs.readFileSync(resolvedJsonPath, "utf-8"));
  console.log(`[migrate] 读取到 ${oldData.tasks.length} 个任务`);

  // 初始化新数据库
  const db = new KanbanDB(resolvedDbPath);

  // 迁移任务
  let migrated = 0;
  for (const oldTask of oldData.tasks) {
    try {
      const newTask = {
        id: oldTask.id,
        title: oldTask.title,
        status: oldTask.status,
        scope: oldTask.scope,
        priority: "normal" as const,
        created_at: new Date(oldTask.createdAt).getTime(),
        started_at: oldTask.startedAt ? new Date(oldTask.startedAt).getTime() : undefined,
        completed_at: oldTask.completedAt ? new Date(oldTask.completedAt).getTime() : undefined,
        blocked_by: oldTask.blockedBy,
      };

      // 直接插入（绕过 addTask 的 ID 生成）
      const stmt = db['db'].prepare(`
        INSERT INTO tasks (id, title, status, scope, priority, created_at, started_at, completed_at, blocked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        newTask.id,
        newTask.title,
        newTask.status,
        newTask.scope,
        newTask.priority,
        newTask.created_at,
        newTask.started_at || null,
        newTask.completed_at || null,
        newTask.blocked_by ? JSON.stringify(newTask.blocked_by) : null
      );
      migrated++;
    } catch (error) {
      console.error(`[migrate] 迁移任务失败: ${oldTask.id}`, error);
    }
  }

  db.close();

  console.log(`[migrate] 迁移完成: ${migrated}/${oldData.tasks.length} 个任务`);

  // 备份旧文件
  const backupPath = resolvedJsonPath + ".backup";
  fs.copyFileSync(resolvedJsonPath, backupPath);
  console.log(`[migrate] 旧数据已备份到: ${backupPath}`);
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("用法: node migrate.js <json-path> <db-path>");
    process.exit(1);
  }

  migrateFromJSON(args[0], args[1]);
}
