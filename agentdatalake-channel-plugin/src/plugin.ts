import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { pluginConfigSchema } from "./config.js";
import { globalState } from "./global-state.js";
import { registerGateways } from "./gateway/register.js";
import { createDebugAwareLogger } from "./logger/debug-aware.js";
import { http } from "./request/index.js";
import { registerTools } from "./tool/index.js";

const plugin = {
  id: "agentdatalake-channel-plugin",
  name: "AgentDataLake Channel Plugin",
  description: "AgentDataLake channel plugin with a generic database query tool.",
  configSchema: pluginConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = pluginConfigSchema.parse(api.pluginConfig);

    globalState.debug = cfg.debug === true;
    globalState.logger = createDebugAwareLogger(api);
    globalState.baseUrl = cfg.baseUrl;

    // Always configure the shared HTTP client with the resolved runtime base URL.
    http.configure({ baseUrl: cfg.baseUrl });

    registerTools({ api });
    registerGateways({ api });
  },
};

export default plugin;
