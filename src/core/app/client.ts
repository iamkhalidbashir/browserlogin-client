import { BrowserLoginClient } from "../api/client.js";
import type { ConnectionStore } from "../config/connection.js";
import { SetupRequiredError } from "../config/connection.js";

export type ApplicationConnection = {
  readonly appOrigin: string;
  readonly remoteMcpUrl: string;
  readonly credentials: () => Promise<string>;
  readonly licenseKey: string | null;
};

export class ApplicationClient {
  private resolvedClient: Promise<BrowserLoginClient> | undefined;

  constructor(
    private readonly connection: ConnectionStore,
    private readonly providedClient?: BrowserLoginClient,
  ) {}

  invalidate(): void {
    this.resolvedClient = undefined;
  }

  async client(): Promise<BrowserLoginClient> {
    if (this.providedClient) return this.providedClient;
    this.resolvedClient ??= this.createClient();
    return this.resolvedClient;
  }

  async remoteConnection(): Promise<ApplicationConnection> {
    const resolved = await this.connection.resolve();
    if (!resolved.apiKey) throw new SetupRequiredError();
    const apiKey = resolved.apiKey;
    return {
      appOrigin: resolved.appOrigin,
      remoteMcpUrl: resolved.remoteMcpUrl,
      credentials: async () => apiKey,
      licenseKey: resolved.licenseKey,
    };
  }

  private async createClient(): Promise<BrowserLoginClient> {
    const resolved = await this.connection.resolve();
    if (!resolved.apiKey) throw new SetupRequiredError();
    const apiKey = resolved.apiKey;
    return new BrowserLoginClient({
      baseUrl: resolved.restBaseUrl,
      credentials: async () => apiKey,
    });
  }
}
