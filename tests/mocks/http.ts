import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

export type Json = Record<string, unknown> | unknown[];
export type MockRequest = { request: IncomingMessage; body: string; json: Json | null };
export type MockHandler = (input: MockRequest, response: ServerResponse) => unknown;

export async function readRequest(request: IncomingMessage): Promise<MockRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  let json: Json | null = null;
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null) json = parsed as Json;
    } catch {
      json = null;
    }
  }
  return { request, body, json };
}

export function sendJson(response: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers });
  response.end(payload);
}

export function sendEmpty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, headers);
  response.end();
}

export async function startServer(handler: MockHandler): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      await handler(await readRequest(request), response);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "mock handler failed" });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not expose an ephemeral port");
  return { server, url: `http://127.0.0.1:${address.port}`, close: async () => { server.close(); await once(server, "close"); } };
}
