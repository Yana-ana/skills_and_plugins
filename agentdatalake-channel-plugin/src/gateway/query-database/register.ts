import { executeQueryDatabase } from "../../tool/query-database/index.js";
import type { GatewayPayload, RegisterGatewayApi } from "../types.js";
import { toGatewayErrorPayload } from "../utils.js";
import { QUERY_DATABASE_GATEWAY_METHODS } from "./utils.js";

export function registerQueryDatabaseGatewayMethods(params: {
  api: RegisterGatewayApi;
}): void {
  params.api.registerGatewayMethod(
    QUERY_DATABASE_GATEWAY_METHODS.query,
    async ({ respond, params: requestParams }: GatewayPayload) => {
      try {
        const result = await executeQueryDatabase(requestParams);
        respond(true, result);
      } catch (error) {
        respond(false, null, toGatewayErrorPayload(error));
      }
    },
  );
}
