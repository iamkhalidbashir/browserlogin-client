import { describe, expect, test } from "vitest";
import {
  BrowserToolsRouter,
  BrowserToolsLifecycle,
  createBrowserTools,
  attachCoordinatorRuntimeStop,
  ProfileResolver,
  RuntimePool,
  SOURCE_MANIFEST_TOOL_COUNT,
  SOURCE_MANIFEST_TOOL_NAMES,
  PRODUCT_TOOLS,
  UNSAFE_TOOL_NAME,
  visibleTools,
  type JsonObject,
  type VendorBrowserRuntime,
  type VendorCallResult,
} from "../../src/core/browser-tools/index.js";

const ok = (text = "ok"): VendorCallResult => ({
  content: [{ type: "text", text }],
});

class FakeRuntime implements VendorBrowserRuntime {
  readonly calls: Array<{ name: string; args: JsonObject }> = [];
  active = 0;
  maxActive = 0;
  constructor(private readonly delay = 0) {}

  async listTools() {
    return PRODUCT_TOOLS.map((tool) => ({ ...tool }));
  }

  async callTool(name: string, args: JsonObject): Promise<VendorCallResult> {
    this.calls.push({ name, args });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.delay)
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    this.active -= 1;
    return ok(name);
  }

  async close(): Promise<void> {
    this.calls.push({ name: "__close__", args: {} });
  }
}

function setup(
  runtimes: Map<string, FakeRuntime>,
  lookup: (
    profile: string,
  ) => Promise<{ relayCdpUrl: string } | undefined> = async (profile) => ({
    relayCdpUrl: `ws://127.0.0.1/${profile}`,
  }),
) {
  const pool = new RuntimePool(async (profile) => {
    const runtime = new FakeRuntime(5);
    runtimes.set(profile, runtime);
    return runtime;
  });
  const router = new BrowserToolsRouter(new ProfileResolver(lookup), pool, {
    stop: async () => ({ state: "stopped" }),
  });
  return { pool, router };
}

describe("browser tools manifest and router", () => {
  test("snapshots the exact source names and clones schemas with required profile", () => {
    expect(SOURCE_MANIFEST_TOOL_COUNT).toBe(24);
    expect(PRODUCT_TOOLS).toHaveLength(25);
    expect(PRODUCT_TOOLS.map((tool) => tool.name)).toContain(
      "browser_file_upload",
    );
    expect(PRODUCT_TOOLS.map((tool) => tool.name)).toContain(
      "browser_handle_dialog",
    );
    expect(PRODUCT_TOOLS.map((tool) => tool.name)).toContain(
      "browser_modal_watch",
    );
    expect(
      PRODUCT_TOOLS.slice(0, SOURCE_MANIFEST_TOOL_COUNT).map(
        (tool) => tool.name,
      ),
    ).toEqual([...SOURCE_MANIFEST_TOOL_NAMES]);
    for (const tool of PRODUCT_TOOLS) {
      expect(tool.inputSchema.required).toContain("profile");
      expect(tool.inputSchema.properties).toHaveProperty("profile");
    }
    expect(
      visibleTools(false).find((tool) => tool.name === "browser_snapshot")
        ?.inputSchema,
    ).not.toBe(
      PRODUCT_TOOLS.find((tool) => tool.name === "browser_snapshot")
        ?.inputSchema,
    );
  });

  test("exposes 24 safe tools and exactly 25 with the exact unsafe flag", async () => {
    const { router } = setup(new Map());
    expect(router.listTools()).toHaveLength(24);
    expect(router.listTools().map((tool) => tool.name)).not.toContain(
      UNSAFE_TOOL_NAME,
    );
    await expect(
      router.call("browser_evaluate", {
        profile: "p1",
        function: "() => 1",
      }),
    ).resolves.not.toMatchObject({ isError: true });
    const previous = process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
    process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = "1";
    expect(setup(new Map()).router.listTools()).toHaveLength(25);
    if (previous === undefined)
      delete process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
    else process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = previous;
  });

  test("returns stable PROFILE_NOT_RUNNING and generic downstream errors", async () => {
    const { router } = setup(new Map(), async () => undefined);
    const stopped = await router.call("browser_snapshot", {
      profile: "stopped",
    });
    expect(stopped).toMatchObject({
      isError: true,
      content: [{ text: "PROFILE_NOT_RUNNING" }],
    });

    const failing = setup(new Map(), async () => {
      throw new Error("secret CDP details");
    }).router;
    const result = await failing.call("browser_snapshot", { profile: "p1" });
    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "Browser control request could not be completed." }],
    });
    expect(JSON.stringify(result)).not.toContain("secret CDP details");
  });

  test("gates unsafe calls and forces browser_type slowly", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const { router } = setup(runtimes);
    const denied = await router.call(UNSAFE_TOOL_NAME, {
      profile: "p1",
      function: "x",
    });
    expect(denied).toMatchObject({ isError: true });
    expect(runtimes).toHaveLength(0);

    const previous = process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
    process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = "1";
    const enabled = setup(runtimes).router;
    await enabled.call(UNSAFE_TOOL_NAME, { profile: "p1", function: "x" });
    if (previous === undefined)
      delete process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
    else process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = previous;
    await router.call("browser_type", {
      profile: "p1",
      text: "a",
      slowly: false,
    });
    expect(runtimes.get("p1")?.calls.map((call) => call.args.slowly)).toEqual([
      true,
    ]);
  });

  test("forwards a timed agent modal watcher without exposing user modal state", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const { router } = setup(runtimes);

    await router.call("browser_modal_watch", {
      profile: "p1",
      kind: "file_upload",
      timeout_ms: 12_000,
    });

    const call = runtimes.get("p1")?.calls.at(-1);
    expect(call).toEqual({
      name: "browser_modal_watch",
      args: { kind: "file_upload", timeout_ms: 12_000 },
    });
  });

  test("implements fill and select shims with Python call order", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const { router } = setup(runtimes);
    await router.call("browser_fill_form", {
      profile: "p1",
      fields: [
        { type: "textbox", target: "#name", element: "Name", value: "Ada" },
        { type: "checkbox", target: "#no", element: "No", value: false },
        { type: "checkbox", target: "#yes", element: "Yes", value: "yes" },
        { type: "radio", target: "#radio", element: "Radio", value: "1" },
        { type: "combobox", target: "#role", element: "Role", value: "admin" },
        { type: "slider", target: "#age", element: "Age", value: 10 },
      ],
    });
    const runtime = runtimes.get("p1")!;
    expect(runtime.calls.map((call) => call.name)).toEqual([
      "browser_type",
      "browser_click",
      "browser_click",
      "browser_click",
      "browser_type",
      "browser_press_key",
    ]);
    expect(runtime.calls[0].args.slowly).toBe(true);
    expect(runtime.calls[4].args.slowly).toBe(true);

    await router.call("browser_select_option", {
      profile: "p1",
      target: "#role",
      values: ["user"],
    });
    expect(runtime.calls.slice(-3).map((call) => call.name)).toEqual([
      "browser_click",
      "browser_type",
      "browser_press_key",
    ]);
    const invalid = await router.call("browser_select_option", {
      profile: "p1",
      target: "#role",
      values: ["a", "b"],
    });
    expect(invalid).toMatchObject({ isError: true });
  });

  test("routes the complete manifest matrix through a fake runtime", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const { router } = setup(runtimes);
    const previous = process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
    process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = "1";
    try {
      for (const name of SOURCE_MANIFEST_TOOL_NAMES) {
        if (
          name === "browser_close" ||
          name === "browser_fill_form" ||
          name === "browser_select_option"
        )
          continue;
        const result = await router.call(name, {
          profile: "matrix",
          code: "() => 1",
          function: "() => 1",
          action: "list",
        });
        expect(result.isError, name).not.toBe(true);
      }
    } finally {
      if (previous === undefined)
        delete process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE;
      else process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE = previous;
    }
    expect(runtimes.get("matrix")?.calls.length).toBe(21);
  });

  test("serializes calls per profile but not across profiles", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    const { router } = setup(runtimes);
    await Promise.all([
      router.call("browser_snapshot", { profile: "same" }),
      router.call("browser_snapshot", { profile: "same" }),
      router.call("browser_snapshot", { profile: "other" }),
      router.call("browser_snapshot", { profile: "other" }),
    ]);
    expect(runtimes.get("same")?.maxActive).toBe(1);
    expect(runtimes.get("other")?.maxActive).toBe(1);
    expect(runtimes).toHaveLength(2);
  });

  test("browser_close uses normal lifecycle stop once and never vendor close", async () => {
    const runtimes = new Map<string, FakeRuntime>();
    let stops = 0;
    const pool = new RuntimePool(async (profile) => {
      const runtime = new FakeRuntime();
      runtimes.set(profile, runtime);
      return runtime;
    });
    const router = new BrowserToolsRouter(
      new ProfileResolver(async () => ({ relayCdpUrl: "ws://127.0.0.1/p1" })),
      pool,
      new BrowserToolsLifecycle(
        pool,
        async () => {
          stops += 1;
          return { state: "stopped" };
        },
        async () => ({ state: "stopped" }),
      ),
    );
    await router.call("browser_snapshot", { profile: "p1" });
    await router.call("browser_close", { profile: "p1" });
    expect(stops).toBe(1);
    expect(runtimes.get("p1")?.calls.at(-1)?.name).toBe("__close__");
  });

  test("force stop closes the runtime and uses only coordinator force stop", async () => {
    const runtime = new FakeRuntime();
    const pool = new RuntimePool(async () => runtime);
    const calls: string[] = [];
    const lifecycle = new BrowserToolsLifecycle(
      pool,
      async (profileId) => calls.push(`stop:${profileId}`),
      async (profileId) => calls.push(`force:${profileId}`),
    );
    await pool.call("p1", "ws://127.0.0.1/p1", async () => ok());

    await lifecycle.forceStop("p1");

    expect(calls).toEqual(["force:p1"]);
    expect(runtime.calls.at(-1)?.name).toBe("__close__");
    expect(pool.size).toBe(0);
  });
});

describe("runtime pool cleanup", () => {
  test("removes failed startups and closes on explicit shutdown hook", async () => {
    let attempts = 0;
    const pool = new RuntimePool(async () => {
      attempts += 1;
      throw new Error("startup detail");
    });
    await expect(
      pool.call("p1", "ws://127.0.0.1/p1", async () => ok()),
    ).rejects.toThrow();
    expect(pool.size).toBe(0);
    expect(attempts).toBe(1);

    const events = new Map<string, () => void>();
    const target = {
      once: (event: string, handler: (...args: unknown[]) => void) => {
        events.set(event, () => handler());
        return target;
      },
    } as unknown as Pick<NodeJS.Process, "once">;
    const runtime = new FakeRuntime();
    const working = new RuntimePool(async () => runtime);
    await working.call("p1", "ws://127.0.0.1/p1", async () => ok());
    working.installProcessShutdownHooks(target);
    events.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.calls.at(-1)?.name).toBe("__close__");
    expect(working.size).toBe(0);
  });

  test("rejects calls queued after profile shutdown begins", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new FakeRuntime();
    const pool = new RuntimePool(async () => runtime);
    const first = pool.call("p1", "ws://127.0.0.1/p1", async () => {
      await gate;
      return "first";
    });
    const closing = pool.closeProfile("p1");
    const queued = pool.call("p1", "ws://127.0.0.1/p1", async () => "queued");
    release();
    await expect(first).resolves.toBe("first");
    await closing;
    await expect(queued).rejects.toThrow("PROFILE_NOT_RUNNING");
    expect(pool.size).toBe(0);
    expect(runtime.calls.at(-1)?.name).toBe("__close__");
  });

  test("replaces a pooled runtime when the relay URL rotates", async () => {
    const runtimes: FakeRuntime[] = [];
    const pool = new RuntimePool(async () => {
      const runtime = new FakeRuntime();
      runtimes.push(runtime);
      return runtime;
    });
    await pool.call("p1", "ws://127.0.0.1/one", async () => ok());
    await pool.call("p1", "ws://127.0.0.1/two", async () => ok());
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0].calls.at(-1)?.name).toBe("__close__");
    expect(runtimes[1].calls.at(-1)?.name).not.toBe("__close__");
  });

  test("production composition installs shutdown and coordinator stop hooks", async () => {
    const events = new Map<string, () => void>();
    const processTarget = {
      once: (event: string, handler: () => void) => {
        events.set(event, handler);
        return processTarget;
      },
    } as unknown as Pick<NodeJS.Process, "once">;
    const runtime = new FakeRuntime();
    let stops = 0;
    const composed = createBrowserTools({
      lookup: async () => ({ relayCdpUrl: "ws://127.0.0.1/p1" }),
      coordinatorStop: async () => {
        stops += 1;
        return { state: "stopped" };
      },
      coordinatorForceStop: async () => ({ state: "stopped" }),
      vendorFactory: async () => runtime,
      processTarget,
    });
    await composed.router.call("browser_snapshot", { profile: "p1" });
    await composed.router.call("browser_close", { profile: "p1" });
    expect(stops).toBe(1);
    expect(events.has("SIGTERM")).toBe(true);
    expect(runtime.calls.at(-1)?.name).toBe("__close__");
    expect(composed.runtimeStop).toBeTypeOf("function");
    const coordinatorOptions = attachCoordinatorRuntimeStop(
      { marker: true },
      composed.runtimeStop,
    );
    expect(coordinatorOptions.runtimeStop).toBe(composed.runtimeStop);
  });
});
