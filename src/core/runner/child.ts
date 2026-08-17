import { constants } from "node:fs";
import { open, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { launchPersistentContext } from "cloakbrowser";
import { resolveCdpEndpoint } from "./cdp.js";
import { protectedLaunchArgs, readAndDeleteLaunchFile } from "./launch.js";
import { waitForAuthorization, publishReady } from "./protocol.js";
import { STOP_MARKER } from "./types.js";
import { routeProxy } from "../proxy/routing.js";
import { Socks5Relay } from "../proxy/socks-relay.js";
import { startCdpRelay, type CdpRelay } from "../cdp/relay.js";
import { BumblebeeWorker } from "../bumblebee/worker.js";
import type {
  BrowserContextLike,
  CloakBrowserSdk,
  RunnerChildOptions,
} from "./types.js";

const defaultSdk: CloakBrowserSdk = {
  launchPersistentContext: (options) =>
    launchPersistentContext(
      options as unknown as Parameters<typeof launchPersistentContext>[0],
    ) as Promise<BrowserContextLike>,
};

const loadSdk = async (): Promise<CloakBrowserSdk> => {
  const override = process.env.BROWSERLOGIN_RUNNER_SDK_MODULE;
  if (process.env.BROWSERLOGIN_RUNNER_TEST_MODE !== "1" || !override)
    return defaultSdk;
  const module = await import(override);
  return (module.default ?? module) as CloakBrowserSdk;
};

const browserConnected = (context: BrowserContextLike): boolean => {
  try {
    return context.browser?.()?.isConnected() ?? true;
  } catch {
    return false;
  }
};

export async function runRunnerChild(
  options: RunnerChildOptions,
): Promise<void> {
  try {
    await waitForAuthorization(options.paths.gateFile, options.gateTimeoutMs);
  } catch (error) {
    await unlink(options.paths.launchFile).catch(() => undefined);
    throw error;
  }
  const spec = await readAndDeleteLaunchFile(options.paths.launchFile);
  if (
    options.expectedProfileId &&
    spec.profile_id !== options.expectedProfileId
  )
    throw new Error("launch profile identity mismatch");
  const sdk = options.sdk ?? (await loadSdk());
  let context: BrowserContextLike | undefined;
  let relay: Socks5Relay | undefined;
  let cdpRelay: CdpRelay | undefined;
  let worker: BumblebeeWorker | undefined;
  let stopped = false;
  let normalStopCalled = false;
  const normalStop = async (): Promise<void> => {
    if (normalStopCalled) return;
    normalStopCalled = true;
    await options.normalStop?.();
  };
  const stop = async (): Promise<void> => {
    stopped = true;
    await normalStop();
  };
  try {
    let proxy: unknown;
    if (spec.proxy) {
      const route = routeProxy({
        ...spec.proxy,
        username: spec.proxy.username ?? undefined,
        password: spec.proxy.password ?? undefined,
      });
      if (route.mode === "relay" && route.upstream) {
        relay = await new Socks5Relay(route.upstream).start();
        proxy = relay.proxyUrl;
      } else proxy = route.launchProxy;
    }
    context = await sdk.launchPersistentContext({
      userDataDir: spec.user_data_dir,
      headless: spec.headless,
      proxy,
      geoip: spec.geoip,
      humanize: spec.humanize,
      humanPreset: spec.human_preset,
      args: protectedLaunchArgs(spec),
      timezone: spec.timezone ?? undefined,
      locale: spec.locale ?? undefined,
      userAgent: spec.user_agent ?? undefined,
      viewport: spec.viewport,
    });
    const onClose = () => {
      void stop();
    };
    context.on("close", onClose);
    const browser = context.browser?.();
    browser?.on?.("disconnected", onClose);
    const pagesAtReady = context.pages().length;
    const upstreamUrl = await resolveCdpEndpoint(
      spec.user_data_dir,
      options.cdpTimeoutMs,
    );
    worker = await BumblebeeWorker.create({
      browserWsUrl: upstreamUrl,
      profile: spec.bumblebee_profile,
      viewport: spec.viewport ?? undefined,
    });
    cdpRelay = await startCdpRelay({ upstreamUrl, worker });
    if (!stopped)
      await publishReady(options.paths.readyFile, {
        version: 1,
        relayCdpUrl: cdpRelay.url,
      });
    if (pagesAtReady === 0) await stop();
    let hadPage = pagesAtReady > 0;
    let controlFailure: unknown;
    const controlWatcher = (async () => {
      while (!stopped) {
        try {
          const fd = await open(
            options.paths.controlFile,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
          );
          let value: string;
          try {
            const info = await fd.stat();
            if (!info.isFile())
              throw new Error("runner control file is not a regular file");
            value = await fd.readFile("utf8");
          } finally {
            await fd.close();
          }
          if (value !== STOP_MARKER)
            throw new Error("runner control file is invalid");
          await unlink(options.paths.controlFile);
          await stop();
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            controlFailure = error;
            await stop();
            return;
          }
        }
        await new Promise((resolve) =>
          setTimeout(resolve, options.pollMs ?? 50),
        );
      }
    })();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 50));
      if (!browserConnected(context)) {
        await stop();
        break;
      }
      const pages = context.pages();
      if (pages.length > 0) hadPage = true;
      else if (hadPage) {
        await stop();
        break;
      }
    }
    await controlWatcher;
    if (controlFailure) throw controlFailure;
    context.off("close", onClose);
    browser?.off?.("disconnected", onClose);
  } finally {
    await cdpRelay?.stop();
    await worker?.close();
    if (context) await context.close();
    await relay?.close();
    await unlink(options.paths.readyFile).catch(() => undefined);
    await unlink(options.paths.controlFile).catch(() => undefined);
  }
}

const argument = (argv: string[], name: string): string => {
  const index = argv.indexOf(name);
  const value = argv[index + 1];
  if (index < 0 || !value) throw new Error(`missing ${name}`);
  return value;
};

if (["child.ts", "child.js"].includes(basename(process.argv[1] ?? ""))) {
  const argv = process.argv.slice(2);
  void runRunnerChild({
    expectedProfileId: argument(argv, "--profile-id"),
    gateTimeoutMs:
      Number(process.env.BROWSERLOGIN_RUNNER_GATE_TIMEOUT_MS) || undefined,
    paths: {
      launchFile: argument(argv, "--launch-file"),
      gateFile: argument(argv, "--gate-file"),
      controlFile: argument(argv, "--control-file"),
      readyFile: argument(argv, "--ready-file"),
    },
  }).catch(async (error) => {
    const diagnostic = process.env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE;
    if (process.env.BROWSERLOGIN_RUNNER_TEST_MODE === "1" && diagnostic)
      await writeFile(
        diagnostic,
        error instanceof Error ? error.message : "runner child failed",
      );
    process.exitCode = 1;
  });
}
