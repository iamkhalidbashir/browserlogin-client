import { z } from "zod";
import {
  AppRPCSchemas,
  type AppRPC,
  type AppRPCMethod,
  type RpcReply,
} from "../shared/rpc-schema.js";

export type AppService = (params: unknown) => unknown | Promise<unknown>;
export type AppServices = Partial<Record<AppRPCMethod, AppService>>;

export type BinaryProgress = {
  downloaded: number;
  total: number | null;
  done: boolean;
};

export type RpcHandlerOptions = {
  services: AppServices;
  emit?: (name: "binaryProgress", payload: BinaryProgress) => void;
};

type AppRPCHandlers = {
  [K in AppRPCMethod]: (
    params: unknown,
  ) => Promise<RpcReply<z.output<(typeof AppRPCSchemas)[K]["result"]>>>;
};

const responseSchemas = new Map<AppRPCMethod, z.ZodType>(
  Object.entries(AppRPCSchemas).map(([name, schema]) => [
    name as AppRPCMethod,
    z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: schema.result }),
      z.object({
        ok: z.literal(false),
        error: z.object({ code: z.string(), message: z.string() }).strict(),
      }),
    ]),
  ]),
);

function errorReply(name: AppRPCMethod, error: unknown): RpcReply {
  if (error instanceof Error) {
    const code = "code" in error ? String(error.code) : "RPC_ERROR";
    return {
      ok: false,
      error: {
        code,
        message: error.message,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "RPC_ERROR",
      message: `${name} could not be completed`,
    },
  };
}

function makeHandler(
  name: AppRPCMethod,
  options: RpcHandlerOptions,
): AppService {
  const schema = AppRPCSchemas[name];
  return async (rawParams: unknown) => {
    const params = schema.params.parse(rawParams);
    const service = options.services[name];
    if (!service)
      return {
        ok: false,
        error: {
          code: "NOT_IMPLEMENTED",
          message: `${name} is not configured`,
        },
      } satisfies RpcReply;
    const value = schema.result.parse(await service(params));
    return { ok: true, value } satisfies RpcReply;
  };
}

export function createRPCHandlers(
  options: RpcHandlerOptions,
): AppRPCHandlers {
  return Object.fromEntries(
    (Object.keys(AppRPCSchemas) as AppRPCMethod[]).map((name) => [
      name,
      async (params: unknown) => {
        try {
          const result = await makeHandler(name, options)(params);
          return responseSchemas.get(name)!.parse(result);
        } catch (error) {
          return responseSchemas.get(name)!.parse(errorReply(name, error));
        }
      },
    ]),
  ) as AppRPCHandlers;
}

export function throttleProgress(
  emit: (payload: BinaryProgress) => void,
  intervalMs = 250,
): (payload: BinaryProgress) => void {
  let last = 0;
  let pending: BinaryProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    last = Date.now();
    const value = pending;
    pending = undefined;
    emit(value);
  };
  return (payload) => {
    const elapsed = Date.now() - last;
    if (payload.done || elapsed >= intervalMs) {
      if (timer) clearTimeout(timer);
      pending = undefined;
      last = Date.now();
      emit(payload);
      return;
    }
    pending = payload;
    if (!timer) timer = setTimeout(flush, intervalMs - elapsed);
  };
}

export async function defineAppRPC(options: RpcHandlerOptions) {
  const handlers = createRPCHandlers(options);
  const { BrowserView: runtimeBrowserView } = await import("electrobun/main");
  const rpc = runtimeBrowserView.defineRPC<AppRPC>({
    maxRequestTime: 30_000,
    handlers: {
      requests: handlers,
    },
  });
  const emitBinaryProgress = throttleProgress((payload) => {
    options.emit?.("binaryProgress", payload);
    rpc.send.binaryProgress(payload);
  });
  const emitUpdateStatus = (payload: { status: string; message: string }) =>
    rpc.send.updateStatus(payload);
  return Object.assign(rpc, { emitBinaryProgress, emitUpdateStatus });
}
