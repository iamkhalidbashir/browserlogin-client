declare module "ws" {
  import { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export type RawData = Buffer | ArrayBuffer | Buffer[];
  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(address: string, options?: { maxPayload?: number });
    send(data: string | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean; maxPayload: number });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void,
    ): void;
    close(callback?: (error?: Error) => void): void;
  }
  export default WebSocket;
}
