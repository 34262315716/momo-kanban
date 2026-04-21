/**
 * 陌陌看板插件 (momo-kanban)
 *
 * 帮助陌陌分解任务、逐步执行、持续追踪的看板工具
 *
 * 核心功能：
 * - 将任务分解为小步骤
 * - 通过 todo → doing → done 状态流转逐步完成任务
 * - 将看板状态持续注入上下文前部，始终可见
 * - 提供系统提示词指引 AI 如何使用看板
 *
 * 开发参考：OpenClaw 插件开发文档
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ========================================
// 类型定义
// ========================================

type TaskStatus = "todo" | "doing" | "done";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface KanbanData {
  tasks: Task[];
  currentTaskId?: string;
  boardName: string;
  lastUpdated: string;
}

interface KanbanConfig {
  dataFile: string;
  injectEnabled: boolean;
  maxTasks: number;
}

// ========================================
// 常量
// ========================================

const BOARD_NAME = "陌陌工作看板";
const INJECT_PREFIX = "【KANBAN_BOARD】";
const DEFAULT_DATA_FILE = "~/.openclaw/data/kanban.json";

const SYSTEM_PROMPT_GUIDANCE = `
【看板使用指南 - 陌陌工作看板】

当你收到一个复杂任务时，使用看板工具将其分解为小步骤，逐步完成。

使用方式：
- 用 kanban_add <任务描述> 将任务分解为多个小步骤（一次加一个）
- 用 kanban_list 查看当前所有步骤和进度
- 用 kanban_do <步骤ID> 开始执行某个步骤
- 用 kanban_done <步骤ID> 标记步骤完成
- 用 kanban_reset 清除看板（任务全部完成或重新开始时）

状态规则：
- todo: 待处理
- doing: 正在做
- done: 已完成

重要：每次只允许一个「doing」任务。开始新任务时旧任务会自动移回 todo。

看板状态会持续注入在上下文中，请随时参考当前进度。
`;

// ========================================
// 配置 Schema（使用 TypeBox）
// ========================================

const configSchema = {
  parse(value: unknown): KanbanConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      dataFile: (raw.dataFile as string) || DEFAULT_DATA_FILE,
      injectEnabled: raw.injectEnabled !== false,
      maxTasks: Math.max(1, (raw.maxTasks as number) || 20),
    };
  },

  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataFile: {
        type: "string",
        default: DEFAULT_DATA_FILE,
        description: "看板数据存储文件路径",
      },
      injectEnabled: {
        type: "boolean",
        default: true,
        description: "是否将看板状态注入到上下文",
      },
      maxTasks: {
        type: "number",
        default: 20,
        description: "最大任务数量",
      },
    },
  },

  uiHints: {
    dataFile: {
      label: "数据文件路径",
      placeholder: "~/.openclaw/data/kanban.json",
    },
    injectEnabled: {
      label: "启用上下文注入",
      help: "开启后看板状态会持续显示在对话上下文中",
    },
    maxTasks: {
      label: "最大任务数",
      help: "看板最多容纳的任务数量",
    },
  },
};

// ========================================
// 看板管理器
// ========================================

class KanbanManager {
  private dataFile: string;
  private maxTasks: number;
  private data: KanbanData;

  constructor(dataFile: string, maxTasks: number) {
    this.dataFile = dataFile.replace(/^~/, os.homedir());
    this.maxTasks = maxTasks;
    this.data = this.load();
  }

  private load(): KanbanData {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, "utf-8");
        const parsed = JSON.parse(content);
        // 验证数据结构
        if (parsed && Array.isArray(parsed.tasks)) {
          return parsed as KanbanData;
        }
      }
    } catch (error) {
      console.error("[momo-kanban] 加载数据失败:", error);
    }
    return this.createEmptyBoard();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error("[momo-kanban] 保存数据失败:", error);
    }
  }

  private createEmptyBoard(): KanbanData {
    return {
      tasks: [],
      boardName: BOARD_NAME,
      lastUpdated: new Date().toISOString(),
    };
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  addTask(title: string): { success: boolean; task?: Task; error?: string } {
    if (this.data.tasks.length >= this.maxTasks) {
      return {
        success: false,
        error: `任务数量已达上限（${this.maxTasks}个）`,
      };
    }

    const task: Task = {
      id: this.generateId(),
      title: title.trim(),
      status: "todo",
      createdAt: new Date().toISOString(),
    };

    this.data.tasks.push(task);
    this.save();
    return { success: true, task };
  }

  listTasks(): KanbanData {
    return { ...this.data };
  }

  doTask(taskId: string): { success: boolean; task?: Task; error?: string } {
    // 将当前 doing 的任务移回 todo
    const currentDoing = this.data.tasks.find((t) => t.status === "doing");
    if (currentDoing && currentDoing.id !== taskId) {
      currentDoing.status = "todo";
      delete currentDoing.startedAt;
    }

    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    task.status = "doing";
    task.startedAt = new Date().toISOString();
    this.data.currentTaskId = taskId;
    this.save();
    return { success: true, task };
  }

  doneTask(taskId: string): { success: boolean; task?: Task; error?: string } {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    task.status = "done";
    task.completedAt = new Date().toISOString();

    if (this.data.currentTaskId === taskId) {
      this.data.currentTaskId = undefined;
    }

    this.save();
    return { success: true, task };
  }

  deleteTask(taskId: string): { success: boolean; error?: string } {
    const index = this.data.tasks.findIndex((t) => t.id === taskId);
    if (index === -1) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    const task = this.data.tasks[index];
    if (task.status === "doing") {
      this.data.currentTaskId = undefined;
    }

    this.data.tasks.splice(index, 1);
    this.save();
    return { success: true };
  }

  resetBoard(): { success: boolean } {
    this.data = this.createEmptyBoard();
    this.save();
    return { success: true };
  }

  getInjectContent(): string {
    if (this.data.tasks.length === 0) {
      return `${INJECT_PREFIX}\n${BOARD_NAME} - 目前没有进行中的任务\n`;
    }

    const lines: string[] = [`${INJECT_PREFIX}`];
    lines.push(BOARD_NAME);
    lines.push("");

    const todoTasks = this.data.tasks.filter((t) => t.status === "todo");
    const doingTasks = this.data.tasks.filter((t) => t.status === "doing");
    const doneTasks = this.data.tasks.filter((t) => t.status === "done");

    if (doingTasks.length > 0) {
      lines.push("🔵 正在做:");
      for (const task of doingTasks) {
        lines.push(`   [${task.id}] ${task.title}`);
      }
      lines.push("");
    }

    if (todoTasks.length > 0) {
      lines.push("📋 待处理:");
      for (const task of todoTasks) {
        lines.push(`   [${task.id}] ${task.title}`);
      }
      lines.push("");
    }

    if (doneTasks.length > 0) {
      lines.push(`✅ 已完成 (${doneTasks.length}):`);
      for (const task of doneTasks) {
        lines.push(`   [${task.id}] ${task.title}`);
      }
    }

    return lines.join("\n");
  }

  getSystemPromptGuidance(): string {
    return SYSTEM_PROMPT_GUIDANCE;
  }
}

// ========================================
// 插件定义
// ========================================

const momoKanbanPlugin = {
  id: "momo-kanban",
  name: "陌陌看板",
  description:
    "陌陌的任务看板，帮助分解任务、逐步执行、持续追踪",
  version: "1.0.0",
  configSchema,

  register(api: OpenClawPluginApi): void {
    const config = configSchema.parse(api.pluginConfig);
    const kanban = new KanbanManager(config.dataFile, config.maxTasks);

    api.logger.info("[momo-kanban] 插件加载中...");

    // ========================================
    // 注册工具：添加任务
    // ========================================
    api.registerTool({
      name: "kanban_add",
      label: "看板添加任务",
      description:
        "将一个大任务分解为小步骤，添加到看板上。参数 title 是任务/步骤的标题描述。",
      parameters: Type.Object({
        title: Type.String({
          description: "任务/步骤的标题描述",
        }),
      }),
      async execute(_toolCallId, params) {
        const title = params?.title;
        if (!title || typeof title !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务标题",
              },
            ],
          };
        }

        const result = kanban.addTask(title);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `添加失败: ${result.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 已添加步骤: ${result.task?.title}\n\n${kanban.getInjectContent()}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：列出任务
    // ========================================
    api.registerTool({
      name: "kanban_list",
      label: "看板列表",
      description: "查看当前看板上的所有任务及其状态。",
      parameters: Type.Object({}),
      async execute(_toolCallId) {
        const board = kanban.listTasks();
        if (board.tasks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "📋 看板上目前没有任务",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: kanban.getInjectContent(),
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：开始执行任务
    // ========================================
    api.registerTool({
      name: "kanban_do",
      label: "看板开始任务",
      description: "开始执行某个任务（标记为doing）。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.doTask(taskId);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `操作失败: ${result.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `🔵 开始执行: ${result.task?.title}\n\n${kanban.getInjectContent()}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：完成任务
    // ========================================
    api.registerTool({
      name: "kanban_done",
      label: "看板完成任务",
      description: "标记一个任务为已完成（done）。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.doneTask(taskId);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `操作失败: ${result.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 已完成: ${result.task?.title}\n\n${kanban.getInjectContent()}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：删除任务
    // ========================================
    api.registerTool({
      name: "kanban_delete",
      label: "看板删除任务",
      description: "从看板上删除一个任务。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.deleteTask(taskId);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `删除失败: ${result.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `🗑️ 已删除任务\n\n${kanban.getInjectContent()}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：重置看板
    // ========================================
    api.registerTool({
      name: "kanban_reset",
      label: "看板重置",
      description: "清除看板上的所有任务。",
      parameters: Type.Object({}),
      async execute(_toolCallId) {
        kanban.resetBoard();
        return {
          content: [
            {
              type: "text" as const,
              text: "🔄 看板已重置\n\n📋 看板上目前没有任务",
            },
          ],
        };
      },
    });

    // ========================================
    // 注册 hooks：注入看板状态到上下文
    // ========================================
    if (config.injectEnabled) {
      api.registerHook({
        event: "before_prompt_build",
        handler: (_event, data) => {
          const boardContent = kanban.getInjectContent();
          const systemGuidance = kanban.getSystemPromptGuidance();

          // 在系统消息之前注入看板状态
          data.promptEntries.unshift({
            role: "system",
            content: `${boardContent}\n\n${systemGuidance}`,
          });

          return data;
        },
      });
      api.logger.info("[momo-kanban] 上下文注入已启用");
    }

    api.logger.info("[momo-kanban] 插件加载完成！");
  },
};

export default momoKanbanPlugin;
