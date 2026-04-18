import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";
import { config } from "./config.js";

const TIMEOUT_MS = 2 * 60 * 1000;

export async function runOAuthLogin(): Promise<string> {
  const apiUrl = config.get("apiUrl");

  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const token = url.searchParams.get("token");
      res.setHeader("content-type", "text/html");
      if (!token) {
        res.statusCode = 400;
        res.end("<p>Missing token. You can close this window.</p>");
        cleanup();
        reject(new Error("OAuth callback missing token"));
        return;
      }
      res.end("<p>Logged in. You can close this window.</p>");
      cleanup();
      resolve(token);
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth login timed out"));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      void open(`${apiUrl}/api/v1/auth/cli/login?cli_port=${port}`);
    });
  });
}
