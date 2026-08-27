import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { basename, dirname } from "node:path";

export const launchPersistentContext = async (options) => {
  const executable = process.env.BROWSERLOGIN_FAKE_EXECUTABLE;
  if (!executable) throw new Error("fake executable is not configured");
  const executableArgs = JSON.parse(
    process.env.BROWSERLOGIN_FAKE_EXECUTABLE_ARGS || "[]",
  );
  const child = spawn(
    executable,
    [
      ...executableArgs,
      ...options.args,
      `--user-data-dir=${options.userDataDir}`,
    ],
    { stdio: "ignore" },
  );
  let connected = true;
  let pageCount = 1;
  let closed = false;
  const closeListeners = new Set();
  const disconnectListeners = new Set();
  const notifyClose = () => {
    if (closed) return;
    closed = true;
    connected = false;
    for (const listener of disconnectListeners) listener();
    for (const listener of closeListeners) listener();
  };
  child.once("exit", notifyClose);
  const browser = {
    isConnected: () => connected,
    on: (_event, listener) => disconnectListeners.add(listener),
    off: (_event, listener) => disconnectListeners.delete(listener),
  };
  const context = {
    pages: () => (pageCount > 0 && connected ? [{}] : []),
    browser: () => browser,
    on: (_event, listener) => closeListeners.add(listener),
    off: (_event, listener) => closeListeners.delete(listener),
    close: async () => {
      if (!connected) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      notifyClose();
    },
  };
  const mode = process.env.FAKE_SDK_LIFECYCLE;
  if (mode === "context-close") setTimeout(() => void context.close(), 3500);
  else if (mode === "disconnect") {
    const disconnectFile = process.env.FAKE_SDK_DISCONNECT_FILE;
    if (!disconnectFile)
      throw new Error("disconnect signal file is not configured");
    const watcher = watch(dirname(disconnectFile), (_event, filename) => {
      if (filename !== basename(disconnectFile)) return;
      watcher.close();
      connected = false;
      for (const listener of disconnectListeners) listener();
      child.kill("SIGTERM");
    });
    child.once("exit", () => watcher.close());
  } else if (mode === "zero-pages")
    setTimeout(() => {
      pageCount = 0;
    }, 300);
  return context;
};

export default { launchPersistentContext };
