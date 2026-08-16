import { RemoteMcpError } from "./errors";
import type { RemoteMcpClient } from "./client";
import type { JsonObject, RemoteTool, RemoteToolCallResult } from "./types";

export function mergeRemoteTools(
  localNames: Iterable<string>,
  remoteTools: readonly RemoteTool[],
  warn: (message: string) => void = (message) => console.error(message),
): RemoteTool[] {
  const local = new Set(localNames);
  return remoteTools.filter((tool) => {
    if (!local.has(tool.name)) return true;
    warn(`remote MCP tool skipped due to local collision: ${tool.name}`);
    return false;
  });
}

export class RemoteMcpForwarder {
  constructor(
    private readonly client: RemoteMcpClient,
    private readonly localNames: ReadonlySet<string>,
  ) {}

  merge(remoteTools: readonly RemoteTool[]): RemoteTool[] {
    return mergeRemoteTools(this.localNames, remoteTools);
  }

  call(
    name: string,
    arguments_: JsonObject = {},
    signal?: AbortSignal,
  ): Promise<RemoteToolCallResult> {
    if (this.localNames.has(name))
      return Promise.reject(
        new RemoteMcpError(
          "REMOTE_PROTOCOL_ERROR",
          "Remote MCP tool is shadowed by a local tool.",
        ),
      );
    return this.client.callTool(name, arguments_, signal);
  }
}
