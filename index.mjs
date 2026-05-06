// Minimal test: ONLY api.on, NO registerHook
const momoKanbanPlugin = {
  id: "momo-kanban",
  name: "\u964C\u964C\u770B\u677F",
  description: "\u6D4B\u8BD5\u7248 - \u53EA\u7528 api.on",
  version: "1.0.0",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      injectEnabled: { type: "boolean", default: true }
    }
  },
  register(api) {
    api.logger.info("=================================");
    api.logger.info("[momo-kanban] \u6D4B\u8BD5\u7248\u52A0\u8F7D\u4E2D...");
    api.logger.info(`[momo-kanban] api.on \u7C7B\u578B: ${typeof api.on}`);
    api.logger.info(`[momo-kanban] api.on.nOOp: ${api.on === (() => {})}`);
    
    // ONLY api.on - no old registerHook calls
    api.on("before_prompt_build", () => {
      api.logger.info("[momo-kanban] before_prompt_build handler \u88AB\u8C03\u7528!");
      return {
        prependSystemContext: "\n[KANBAN_STATUS] \u964C\u964C\u770B\u677F\u72B6\u6001\u6D4B\u8BD5 - \u5982\u679C\u770B\u5230\u8FD9\u6BB5\u8BDD\uFF0C\u8BF4\u660E api.on \u5DE5\u4F5C\u6B63\u5E38\uFF01\n"
      };
    });
    
    api.logger.info("[momo-kanban] api.on \u6CE8\u518C\u5B8C\u6210");
    api.logger.info("=================================");

    // Keep one tool so plugin isn't empty
    api.registerTool({
      name: "kanban_test_ping",
      description: "\u6D4B\u8BD5 api.on \u662F\u5426\u6B63\u5E38\u5DE5\u4F5C",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { content: [{ type: "text", text: "pong - api.on test plugin loaded!" }] };
      }
    });
  }
};

export default momoKanbanPlugin;
