const initialize = ({ page }) => {
  const controllers = globalThis.__browserloginModalControllers;
  if (!(controllers instanceof WeakMap))
    throw new Error("BrowserLogin modal controller registry is unavailable");
  const handlers = new Map([
    ["filechooser", page.listeners("filechooser")],
    ["dialog", page.listeners("dialog")],
    ["dialogclosed", page.listeners("dialogclosed")],
  ]);
  page.removeAllListeners("filechooser");
  page.removeAllListeners("dialog");
  page.removeAllListeners("dialogclosed");
  page.on("dialog", () => undefined);

  const timeouts = new Map();
  const eventNames = (event) =>
    event === "dialog" ? ["dialog", "dialogclosed"] : [event];
  const release = (event) => {
    const timeout = timeouts.get(event);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeouts.delete(event);
    }
    for (const name of eventNames(event)) {
      for (const handler of handlers.get(name) ?? [])
        page.removeListener(name, handler);
    }
  };

  const watch = (event, timeoutMs) => {
    release(event);
    for (const name of eventNames(event)) {
      for (const handler of handlers.get(name) ?? []) page.on(name, handler);
    }
    timeouts.set(event, setTimeout(() => release(event), timeoutMs));
  };
  controllers.set(page, { release, watch });
};

module.exports = {
  default: initialize,
  source: `module.exports.default = ${initialize.toString()};\n`,
};
