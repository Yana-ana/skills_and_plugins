import { globalState } from "../../global-state.js";
import { PLUGIN_VERSION } from "../../plugin-metadata.js";
import { QUERY_DATABASE_PATH } from "../../tool/query-database/index.js";
import type { GatewayPayload, RegisterGatewayApi } from "../types.js";
import { STATUS_GATEWAY_METHODS } from "./utils.js";

export function registerStatusGatewayMethods(params: {
  api: RegisterGatewayApi;
}): void {
  params.api.registerGatewayMethod(
    STATUS_GATEWAY_METHODS.get,
    async ({ respond }: GatewayPayload) => {
      respond(true, {
        ok: true,
        baseUrl: globalState.baseUrl,
        endpoint: QUERY_DATABASE_PATH,
        tool: "query_database",
      });
    },
  );

  params.api.registerGatewayMethod(
    STATUS_GATEWAY_METHODS.version,
    async ({ respond }: GatewayPayload) => {
      respond(true, { version: PLUGIN_VERSION });
    },
  );
}
