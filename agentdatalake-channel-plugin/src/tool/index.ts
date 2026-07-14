import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerQueryDatabaseTool } from "./query-database/index.js";

export const registerTools = (params: { api: OpenClawPluginApi }) => {
  registerQueryDatabaseTool(params.api);
};
