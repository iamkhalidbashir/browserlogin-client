#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { fstatSync } from "node:fs";
import { dirname } from "node:path";

const argv = process.argv.slice(2);
const argument = (name) =>
  argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const userDataDir =
  argument("--user-data-dir") || process.env.FAKE_BROWSER_USER_DATA_DIR;
const argvFile = process.env.FAKE_BROWSER_ARGV_FILE;
const exitFile = process.env.FAKE_BROWSER_EXIT_FILE;
const logFile = process.env.FAKE_BROWSER_LOG_FILE;
if (!userDataDir) process.exit(78);
const log = async (value) => {
  if (logFile) await writeFile(logFile, `${value}\n`, { flag: "a" });
};
for (const fd of [0, 1, 2, 3, 4]) {
  try {
    await log(`fd${fd}:${fstatSync(fd).mode}`);
  } catch {
    await log(`fd${fd}:error`);
  }
}

await mkdir(userDataDir, { recursive: true });
if (argvFile) {
  await mkdir(dirname(argvFile), { recursive: true });
  await writeFile(argvFile, JSON.stringify(argv));
}

const server = createServer((request, response) => {
  if (request.url === "/json/version") {
    const body = JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser/fake`,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  response.writeHead(404);
  response.end();
});
const requestedPort = Number(process.env.FAKE_BROWSER_CDP_PORT) || 0;
await new Promise((resolve) =>
  server.listen(requestedPort, "127.0.0.1", resolve),
);
const port = server.address().port;
const wsEndpoint = `ws://127.0.0.1:${port}/devtools/browser/fake`;
process.stdout.write(`DevTools listening on ${wsEndpoint}\n`);
process.stderr.write(`DevTools listening on ${wsEndpoint}\n`);
await log(`listening:${port}`);
await writeFile(
  `${userDataDir}/DevToolsActivePort`,
  `${port}\n/devtools/browser/fake\n`,
);

const shutdown = async (code = 0) => {
  await log(`exit:${code}`);
  await new Promise((resolve) => server.close(() => resolve()));
  if (exitFile) await writeFile(exitFile, String(code));
  process.exit(code);
};
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));
if (process.env.FAKE_BROWSER_EXIT_AFTER_MS) {
  setTimeout(
    () => void shutdown(0),
    Number(process.env.FAKE_BROWSER_EXIT_AFTER_MS),
  );
}
