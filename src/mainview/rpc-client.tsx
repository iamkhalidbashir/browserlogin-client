import { createContext, useContext, type PropsWithChildren } from "react";
import type { z } from "zod";
import {
  AppRPCSchemas,
  RpcReplySchema,
  type AppRPC,
  type AppRPCMethod,
  type RpcReply,
} from "../shared/rpc-schema.js";

export type BridgeParams<K extends AppRPCMethod> = z.infer<
  (typeof AppRPCSchemas)[K]["params"]
>;
export type BridgeResult<K extends AppRPCMethod> = z.infer<
  (typeof AppRPCSchemas)[K]["result"]
>;

export type Bridge = {
  request<K extends AppRPCMethod>(
    method: K,
    params: BridgeParams<K>,
  ): Promise<RpcReply<BridgeResult<K>>>;
};

const BridgeContext = createContext<Bridge | null>(null);

export function BridgeProvider({
  bridge,
  children,
}: PropsWithChildren<{ bridge: Bridge }>) {
  return (
    <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>
  );
}

export function useBridge(): Bridge {
  const bridge = useContext(BridgeContext);
  if (!bridge) throw new Error("BrowserLogin RPC bridge is unavailable");
  return bridge;
}

export async function createElectrobunBridge(): Promise<Bridge> {
  const { Electroview } = await import("electrobun/view");
  const rpc = Electroview.defineRPC<AppRPC>({
    maxRequestTime: 30_000,
    handlers: {},
  });
  new Electroview({ rpc });
  return {
    async request<K extends AppRPCMethod>(
      method: K,
      params: BridgeParams<K>,
    ): Promise<RpcReply<BridgeResult<K>>> {
      const parsed = RpcReplySchema.parse(await rpc.request(method, params));
      if (!parsed.ok) return parsed;
      const value = AppRPCSchemas[method].result.parse(
        parsed.value,
      ) as BridgeResult<K>;
      return { ok: true, value };
    },
  };
}
