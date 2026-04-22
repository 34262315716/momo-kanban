/**
 * OpenClaw Plugin SDK 类型声明
 *
 * 这些类型是根据 OpenClaw 插件 API 推断的，
 * 用于让 VSCode/TypeScript 不报错。
 * 实际运行时由 OpenClaw 运行时提供实现。
 */

declare module "openclaw/plugin-sdk/core" {
  export interface ToolContent {
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }

  export interface ToolResult {
    content: ToolContent[];
    isError?: boolean;
  }

  export interface ToolDefinition {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params?: Record<string, unknown>
    ): Promise<ToolResult>;
  }

  export interface HookCallback {
    (event: any, data?: any): any;
  }

  export interface HookOptions {
    name: string;
    description?: string;
  }

  export interface OpenClawPluginApi {
    pluginConfig: unknown;

    logger: {
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
      debug(message: string): void;
    };

    registerTool(tool: ToolDefinition): void;

    registerHook(
      hookName: string,
      callback: HookCallback,
      options?: HookOptions
    ): void;
  }

  export interface OpenClawPlugin {
    id: string;
    name: string;
    version: string;
    description?: string;
    configSchema?: unknown;
    uiHints?: unknown;
    register(api: OpenClawPluginApi): void;
  }
}
