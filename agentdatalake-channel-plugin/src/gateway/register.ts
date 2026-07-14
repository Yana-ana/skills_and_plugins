import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerQueryDatabaseGatewayMethods } from "./query-database/register.js";
import { registerStatusGatewayMethods } from "./status/register.js";

export function registerGateways(params: { api: OpenClawPluginApi }): void {
  registerStatusGatewayMethods(params);
  registerQueryDatabaseGatewayMethods(params);
}
