/**
 * 看板管理器 V2 - 集成所有增强功能
 */

import { KanbanDB, Task, TaskStatus, TaskPriority, Template } from "./db";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

export interface AddTaskOptions {
  title: string;
  scope?: string;
  priority?: TaskPriority;
  tags?: string[];
  notes?: string;
  blockedBy?: string[];
  deadline?: number;
  remindBeforeMs?: number;
  assignedTo?: string;      // 分配给哪个子代理
  parentSession?: string;   // 父会话
}

export interface ListTasksOptions {
  scope?: string;
  showAll?: boolean;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
}

export class KanbanManagerV2 {
  private db: KanbanDB;
  private defaultScope: string;
  private boardName: string;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void };

  constructor(
    dbPath: string,
    defaultScope: string,
    boardName: string,
    logger: { info: (msg: string) => void; warn: (msg: string) => void }
  ) {
    this.db = new KanbanDB(dbPath);
    this.defaultScope = defaultScope;
    this.boardName = boardName;
    this.logger = logger;
  }

  // ========================================
  // 自动 scope 解析
  // ========================================

  /**
   * 从上下文自动推断 scope
   * 优先级：显式指定 > session_key > chat_id > 默认
   */
  resolveScope(explicitScope?: string, context?: any): string {
    if (explicitScope) return explicitScope;

    // 子代理：使用 session_key 作为 scope
    if (context?.session_key && context.session_key !== "main") {
      return `session:${context.session_key}`;
    }

    // 从上下文提取 chat_id
    if (context?.chat_id) {
      return `chat:${context.chat_id}`;
    }

    return this.defaultScope;
  }

  /**
   * 获取当前 session_key
   */
  getSessionKey(context?: any): string {
    return context?.session_key || "main";
  }

  /**
   * 检查任务是否对当前会话可见
   * 规则：
   * 1. 自己 scope 的任务可见
   * 2. 分配给自己的任务可见
   * 3. 主会话可以看到所有任务
   */
  isTaskVisible(task: Task, context?: any): boolean {
    const sessionKey = this.getSessionKey(context);
    const currentScope = this.resolveScope(undefined, context);

    // 主会话可以看到所有任务
    if (sessionKey === "main") {
      return true;
    }

    // 自己 scope 的任务
    if (task.scope === currentScope) {
      return true;
    }

    // 分配给自己的任务
    if (task.assigned_to === sessionKey) {
      return true;
    }

    return false;
  }

  // ========================================
  // 任务操作
  // ========================================

  addTask(options: AddTaskOptions, context?: any): { success: boolean; task?: Task; error?: string } {
    try {
      const scope = this.resolveScope(options.scope, context);
      const sessionKey = this.getSessionKey(context);

      // 验证依赖
      if (options.blockedBy && options.blockedBy.length > 0) {
        for (const depId of options.blockedBy) {
          const dep = this.db.getTask(depId);
          if (!dep) {
            return { success: false, error: `依赖任务不存在: ${depId}` };
          }
        }
      }

      const task = this.db.addTask({
        title: options.title,
        status: "todo",
        scope,
        priority: options.priority || "normal",
        notes: options.notes,
        blocked_by: options.blockedBy,
        deadline: options.deadline,
        remind_before_ms: options.remindBeforeMs,
        tags: options.tags,
        assigned_to: options.assignedTo,
        parent_session: options.parentSession || (sessionKey !== "main" ? "main" : undefined),
      });

      return { success: true, task };
    } catch (error: any) {
      this.logger.warn(`[kanban] 添加任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  listTasks(options: ListTasksOptions = {}, context?: any): Task[] {
    const scope = options.showAll ? undefined : this.resolveScope(options.scope, context);
    const sessionKey = this.getSessionKey(context);

    let tasks = this.db.getTasks({
      scope,
      status: options.status,
      priority: options.priority,
      tags: options.tags,
    });

    // 子代理权限过滤：只看到自己 scope + 分配给自己的任务
    if (sessionKey !== "main") {
      tasks = tasks.filter((task) => this.isTaskVisible(task, context));
    }

    return tasks;
  }

  doTask(taskId: string): { success: boolean; task?: Task; error?: string; blockedInfo?: string } {
    try {
      const task = this.db.getTask(taskId);
      if (!task) {
        return { success: false, error: `找不到任务: ${taskId}` };
      }

      // 检查依赖
      if (task.blocked_by && task.blocked_by.length > 0) {
        const unfinished = task.blocked_by.filter((depId) => {
          const dep = this.db.getTask(depId);
          return dep && dep.status !== "done";
        });

        if (unfinished.length > 0) {
          const blockerNames = unfinished.map((id) => {
            const dep = this.db.getTask(id);
            return dep ? `[${dep.id}] ${dep.title}` : id;
          });
          return {
            success: false,
            error: "任务被依赖阻塞",
            blockedInfo: `需要先完成:\n${blockerNames.map((n) => `  • ${n}`).join("\n")}`,
          };
        }
      }

      // 将同 scope 当前 doing 的任务移回 todo
      const currentDoing = this.db.getTasks({ scope: task.scope, status: "doing" });
      for (const t of currentDoing) {
        if (t.id !== taskId) {
          this.db.updateTask(t.id, { status: "todo", started_at: undefined });
        }
      }

      // 开始任务
      this.db.updateTask(taskId, { status: "doing", started_at: Date.now() });
      const updatedTask = this.db.getTask(taskId)!;

      return { success: true, task: updatedTask };
    } catch (error: any) {
      this.logger.warn(`[kanban] 开始任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  doneTask(taskId: string): { success: boolean; task?: Task; error?: string; unlockedTasks?: Task[] } {
    try {
      const task = this.db.getTask(taskId);
      if (!task) {
        return { success: false, error: `找不到任务: ${taskId}` };
      }

      // 完成任务
      this.db.updateTask(taskId, { status: "done", completed_at: Date.now() });
      const updatedTask = this.db.getTask(taskId)!;

      // 检查解锁的下游任务
      const allTasks = this.db.getTasks({ scope: task.scope });
      const unlockedTasks: Task[] = [];

      for (const t of allTasks) {
        if (t.status !== "todo" || !t.blocked_by || !t.blocked_by.includes(taskId)) continue;

        const allDepsComplete = t.blocked_by.every((depId) => {
          const dep = this.db.getTask(depId);
          return dep && dep.status === "done";
        });

        if (allDepsComplete) {
          unlockedTasks.push(t);
        }
      }

      return { success: true, task: updatedTask, unlockedTasks };
    } catch (error: any) {
      this.logger.warn(`[kanban] 完成任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  deleteTask(taskId: string): { success: boolean; error?: string } {
    try {
      const success = this.db.deleteTask(taskId);
      if (!success) {
        return { success: false, error: `找不到任务: ${taskId}` };
      }
      return { success: true };
    } catch (error: any) {
      this.logger.warn(`[kanban] 删除任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  updateTask(taskId: string, updates: Partial<Task>): { success: boolean; task?: Task; error?: string } {
    try {
      const success = this.db.updateTask(taskId, updates);
      if (!success) {
        return { success: false, error: `找不到任务: ${taskId}` };
      }
      const task = this.db.getTask(taskId)!;
      return { success: true, task };
    } catch (error: any) {
      this.logger.warn(`[kanban] 更新任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  archiveTask(taskId: string): { success: boolean; error?: string } {
    try {
      const success = this.db.updateTask(taskId, { status: "archived", archived_at: Date.now() });
      if (!success) {
        return { success: false, error: `找不到任务: ${taskId}` };
      }
      return { success: true };
    } catch (error: any) {
      this.logger.warn(`[kanban] 归档任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  resetBoard(scope?: string, context?: any): { success: boolean; removedCount: number } {
    try {
      const resolvedScope = scope ? this.resolveScope(scope, context) : undefined;
      const tasks = this.db.getTasks({ scope: resolvedScope });
      let removed = 0;

      for (const task of tasks) {
        if (this.db.deleteTask(task.id)) {
          removed++;
        }
      }

      return { success: true, removedCount: removed };
    } catch (error: any) {
      this.logger.warn(`[kanban] 重置看板失败: ${error.message}`);
      return { success: false, removedCount: 0 };
    }
  }

  // ========================================
  // 模板操作
  // ========================================

  saveTemplate(template: Omit<Template, "created_at" | "updated_at">): { success: boolean; template?: Template; error?: string } {
    try {
      const saved = this.db.saveTemplate(template);
      return { success: true, template: saved };
    } catch (error: any) {
      this.logger.warn(`[kanban] 保存模板失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  applyTemplate(templateId: string, scope?: string, context?: any): { success: boolean; tasks?: Task[]; error?: string } {
    try {
      const template = this.db.getTemplate(templateId);
      if (!template) {
        return { success: false, error: `找不到模板: ${templateId}` };
      }

      const resolvedScope = this.resolveScope(scope, context);
      const createdTasks: Task[] = [];
      const idMap: Record<number, string> = {};

      // 第一轮：创建所有任务（不设置依赖）
      for (const templateTask of template.tasks) {
        const task = this.db.addTask({
          title: templateTask.title,
          status: "todo",
          scope: resolvedScope,
          priority: templateTask.priority,
          notes: templateTask.notes,
          template_id: templateId,
        });
        idMap[templateTask.order_index] = task.id;
        createdTasks.push(task);
      }

      // 第二轮：设置依赖关系
      for (const templateTask of template.tasks) {
        if (templateTask.blocked_by_indexes && templateTask.blocked_by_indexes.length > 0) {
          const blockedBy = templateTask.blocked_by_indexes.map((idx) => idMap[idx]);
          const taskId = idMap[templateTask.order_index];
          this.db.updateTask(taskId, { blocked_by: blockedBy });
        }
      }

      // 重新获取任务（包含依赖信息）
      const finalTasks = createdTasks.map((t) => this.db.getTask(t.id)!);

      return { success: true, tasks: finalTasks };
    } catch (error: any) {
      this.logger.warn(`[kanban] 应用模板失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  listTemplates(): Template[] {
    return this.db.getTemplates();
  }

  deleteTemplate(templateId: string): { success: boolean; error?: string } {
    try {
      const success = this.db.deleteTemplate(templateId);
      if (!success) {
        return { success: false, error: `找不到模板: ${templateId}` };
      }
      return { success: true };
    } catch (error: any) {
      this.logger.warn(`[kanban] 删除模板失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // 上下文注入
  // ========================================

  getInjectContent(scope?: string, context?: any): string {
    const resolvedScope = scope ? this.resolveScope(scope, context) : undefined;
    const sessionKey = this.getSessionKey(context);
    let tasks = this.db.getTasks({ scope: resolvedScope });

    // 子代理权限过滤
    if (sessionKey !== "main") {
      tasks = tasks.filter((task) => this.isTaskVisible(task, context));
    }

    if (tasks.length === 0) {
      return `[KANBAN_BOARD]\n${this.boardName} - No active tasks\n`;
    }

    const lines: string[] = ["[KANBAN_BOARD]"];
    lines.push(resolvedScope ? `${this.boardName} [scope: ${resolvedScope}]` : this.boardName);
    lines.push("");

    // 按 scope 分组
    const scopes = [...new Set(tasks.map((t) => t.scope))];
    const multiScope = scopes.length > 1;

    for (const s of scopes) {
      const scopeTasks = tasks.filter((t) => t.scope === s);
      if (multiScope) {
        lines.push(`📁 Scope: ${s}`);
        lines.push("");
      }

      // 按优先级和状态分组
      const priorityOrder: TaskPriority[] = ["urgent", "high", "normal", "low"];
      const statusGroups = {
        doing: scopeTasks.filter((t) => t.status === "doing"),
        todo: scopeTasks.filter((t) => t.status === "todo"),
        done: scopeTasks.filter((t) => t.status === "done"),
      };

      // IN PROGRESS
      if (statusGroups.doing.length > 0) {
        lines.push("🔵 IN PROGRESS:");
        for (const task of statusGroups.doing) {
          lines.push(`   ${this.formatTask(task)}`);
        }
        lines.push("");
      }

      // TODO (按优先级排序)
      if (statusGroups.todo.length > 0) {
        lines.push("📋 TODO:");
        const sorted = statusGroups.todo.sort((a, b) => {
          return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
        });
        for (const task of sorted) {
          lines.push(`   ${this.formatTask(task)}`);
        }
        lines.push("");
      }

      // DONE
      if (statusGroups.done.length > 0) {
        lines.push(`✅ DONE (${statusGroups.done.length}):`);
        for (const task of statusGroups.done.slice(0, 5)) {
          lines.push(`   ${this.formatTask(task)}`);
        }
        if (statusGroups.done.length > 5) {
          lines.push(`   ... and ${statusGroups.done.length - 5} more`);
        }
      }

      if (multiScope) lines.push("");
    }

    return lines.join("\n");
  }

  private formatTask(task: Task): string {
    const parts: string[] = [];

    // 优先级图标
    const priorityIcons: Record<TaskPriority, string> = {
      urgent: "🔴",
      high: "🟡",
      normal: "⚪",
      low: "🔵",
    };
    if (task.priority !== "normal") {
      parts.push(priorityIcons[task.priority]);
    }

    // 任务 ID 和标题
    parts.push(`[${task.id}] ${task.title}`);

    // 标签
    if (task.tags && task.tags.length > 0) {
      parts.push(`#${task.tags.join(" #")}`);
    }

    // 依赖状态
    if (task.blocked_by && task.blocked_by.length > 0) {
      const unfinished = task.blocked_by.filter((depId) => {
        const dep = this.db.getTask(depId);
        return dep && dep.status !== "done";
      });
      if (unfinished.length > 0) {
        parts.push(`🔒阻塞(${unfinished.length})`);
      } else {
        parts.push("✅解锁");
      }
    }

    // 截止时间
    if (task.deadline) {
      const now = Date.now();
      const remaining = task.deadline - now;
      if (remaining < 0) {
        parts.push("⏰已逾期");
      } else if (remaining < 24 * 60 * 60 * 1000) {
        parts.push("⏰今日截止");
      }
    }

    return parts.join(" ");
  }

  close(): void {
    this.db.close();
  }
}
