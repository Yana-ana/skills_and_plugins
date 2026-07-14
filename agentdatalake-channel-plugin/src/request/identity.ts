import http from "node:http";
import os from "node:os";
import path from "node:path";

const SOCKET_PATH =
  process.env.IDENTITY_SOCKET ??
  path.join(os.homedir(), ".openclaw", "plugins", "identity", "identity.sock");

function get(endpoint: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: SOCKET_PATH, path: endpoint }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export const getTipToken = () =>
  get("/token").then((res) => (res as { tipToken?: string })?.tipToken ?? "");
