import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";

const snippet = JSON.stringify(
  {
    browserlogin: {
      type: "local",
      command: ["browserlogin", "mcp"],
      enabled: true,
    },
  },
  null,
  2,
);

export default function SettingsView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("https://example.test/api/v1");
  const [apiKey, setApiKey] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [updateState, setUpdateState] = useState("Current");
  const [binaryAction, setBinaryAction] = useState<
    "free" | "license" | "custom" | null
  >(null);
  const [message, setMessage] = useState("");
  const [logFilter, setLogFilter] = useState("");
  const [autoCheck, setAutoCheck] = useState(true);
  const connection = useQuery({
    queryKey: ["settings-connection"],
    queryFn: async () => {
      const result = await bridge.request("connectionGet", {});
      if (!result.ok) throw new Error(result.error.message);
      setBaseUrl(result.value.baseUrl);
      return result.value;
    },
  });
  const license = useQuery({
    queryKey: ["license"],
    queryFn: async () => {
      const result = await bridge.request("licenseStatus", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const result = await bridge.request("settingsGet", {});
      if (!result.ok) throw new Error(result.error.message);
      setCustomUrl(result.value.custom_download_url ?? "");
      return result.value;
    },
  });
  const binary = useQuery({
    queryKey: ["binary"],
    queryFn: async () => {
      const result = await bridge.request("binaryStatus", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const binaryProgress = useQuery({
    queryKey: ["binary-progress"],
    queryFn: async () => {
      const result = await bridge.request("binaryProgress", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    refetchInterval: binaryAction ? 500 : false,
  });
  const logs = useQuery({
    queryKey: ["logs"],
    queryFn: async () => {
      const result = await bridge.request("logsTail", { lines: 500 });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.lines;
    },
  });
  const filteredLogs = useMemo(
    () =>
      (logs.data ?? []).filter((line) =>
        line.toLowerCase().includes(logFilter.toLowerCase()),
      ),
    [logs.data, logFilter],
  );
  const saveConnection = async () => {
    const result = await bridge.request("connectionSet", { baseUrl, apiKey });
    if (result.ok) {
      const tested = await bridge.request("connectionTest", {});
      setMessage(
        tested.ok && tested.value.connected
          ? "Connection verified."
          : "Connection test failed.",
      );
      setApiKey("");
    }
  };
  const disconnect = async () => {
    await bridge.request("connectionClear", {});
    await queryClient.invalidateQueries({ queryKey: ["connection"] });
    setMessage("Connection removed from keychain and local configuration.");
  };
  const saveLicense = async () => {
    const result = await bridge.request("licenseSet", { licenseKey });
    setLicenseKey("");
    if (result.ok) {
      setMessage("Pro license configured. Concurrency follows your plan tier.");
      await license.refetch();
    }
  };
  const clearLicense = async () => {
    await bridge.request("licenseClear", {});
    setMessage("License cleared; keyless Free channel remains available.");
    await license.refetch();
  };
  const saveSource = async () => {
    const result = await bridge.request("settingsSet", {
      downloadSource: customUrl ? "custom" : "official",
      customDownloadUrl: customUrl || null,
      advancedEnabled: advanced,
      autoCheckUpdates: autoCheck,
    });
    setMessage(result.ok ? "Download settings saved." : result.error.message);
  };
  const installBinary = async (source: "free" | "license" | "custom") => {
    setBinaryAction(source);
    setMessage("Downloading and verifying CloakBrowser…");
    const result = await bridge.request("binaryDownload", {
      advancedEnabled: source === "custom" ? advanced : false,
      source,
      ...(source === "custom" && customUrl ? { customUrl } : {}),
    });
    setBinaryAction(null);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage(
      `CloakBrowser ${result.value.version ?? "custom"} is installed and active.`,
    );
    await Promise.all([binary.refetch(), binaryProgress.refetch()]);
  };
  const checkUpdate = async () => {
    setUpdateState("Checking…");
    const result = await bridge.request("updatesCheck", {});
    setUpdateState(
      result.ok && result.value.updateAvailable
        ? "Update available"
        : "Current",
    );
  };
  const downloadUpdate = async () => {
    setUpdateState("Downloading…");
    const result = await bridge.request("updatesDownload", {});
    setUpdateState(
      result.ok && result.value.updateReady
        ? "Ready to relaunch"
        : result.ok && result.value.updateAvailable
          ? "Update available"
          : "Current",
    );
  };
  const installCli = async () => {
    const result = await bridge.request("cliInstall", {});
    setMessage(result.ok ? result.value.message : result.error.message);
  };
  const validCustom =
    !customUrl ||
    /^https:\/\//.test(customUrl) ||
    /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(customUrl);
  return (
    <section>
      <p className="eyebrow">Application</p>
      <h2 className="text-3xl font-semibold">Settings</h2>
      <p className="mt-2 text-zinc-500">
        Connection, license, trusted downloads, CLI, updates, and local
        diagnostics.
      </p>
      <div className="settings-grid mt-6">
        <article className="panel">
          <h3 className="font-medium">Connection</h3>
          <p className="mt-1 text-sm text-zinc-500">
            API key: {connection.data?.hasApiKey ? "Set" : "Not set"}
          </p>
          <label className="field mt-4">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="field mt-3">
            <span>Re-enter API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <button
              className="button-primary"
              disabled={!apiKey}
              onClick={() => void saveConnection()}
            >
              Save and test
            </button>
            <button className="button-danger" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </article>
        <article className="panel">
          <h3 className="font-medium">CloakBrowser license</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Plan tier: {license.data?.hasLicense ? "Pro configured" : "Free"}.
            Licensed plans enable their documented concurrency; Free remains
            keyless.
          </p>
          <label className="field mt-4">
            <span>License key</span>
            <input
              type="password"
              autoComplete="off"
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <button
              className="button-primary"
              disabled={!licenseKey}
              onClick={() => void saveLicense()}
            >
              Set license
            </button>
            <button
              className="button-secondary"
              onClick={() => void clearLicense()}
            >
              Clear
            </button>
          </div>
        </article>
        <article className="panel">
          <h3 className="font-medium">CloakBrowser runtime</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Install or replace the active browser from the latest Free release,
            your licensed channel, or an explicit custom source.
          </p>
          <div className={advanced ? "runtime-warning" : "mt-3"}>
            <label className="check-field">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(event) => setAdvanced(event.target.checked)}
              />
              Advanced: I understand that custom sources are unverified.
            </label>
          </div>
          <label className="field mt-3">
            <span>Custom URL</span>
            <input
              disabled={!advanced}
              placeholder="https://downloads.example.test"
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
            />
          </label>
          {!validCustom ? (
            <p className="mt-2 text-sm text-red-500" role="alert">
              Use HTTPS or loopback HTTP for tests.
            </p>
          ) : null}
          <button
            className="button-secondary mt-4"
            disabled={!validCustom || (Boolean(customUrl) && !advanced)}
            onClick={() => void saveSource()}
          >
            Save source
          </button>
          <p className="mt-3 text-sm text-zinc-500">
            Installed:{" "}
            {binary.data
              ? `${binary.data.version ?? "custom"} · ${binary.data.pro ? "Pro" : "Free"} · active`
              : "No active binary"}
          </p>
          <div className="mt-4 grid gap-2">
            <button
              className="button-primary"
              disabled={binaryAction !== null}
              onClick={() => void installBinary("free")}
            >
              Install latest Free
            </button>
            <button
              className="button-secondary"
              disabled={binaryAction !== null || !license.data?.hasLicense}
              onClick={() => void installBinary("license")}
            >
              Install licensed release
            </button>
            <button
              className="button-secondary"
              disabled={
                binaryAction !== null || !advanced || !customUrl || !validCustom
              }
              onClick={() => void installBinary("custom")}
            >
              Install from custom URL
            </button>
          </div>
          {binaryAction ? (
            <div className="mt-3" aria-live="polite">
              <progress
                aria-label="CloakBrowser download progress"
                className="w-full"
                max={binaryProgress.data?.total ?? 1}
                value={binaryProgress.data?.downloaded ?? 0}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Downloading {binaryAction} runtime…
              </p>
            </div>
          ) : null}
        </article>
        <article className="panel">
          <h3 className="font-medium">CLI integration</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Replaces both bl_client and browserSessionMCP entries.
          </p>
          <pre className="code-block mt-3">{snippet}</pre>
          <button
            className="button-primary mt-3"
            onClick={() => void installCli()}
          >
            Install browserlogin CLI
          </button>
        </article>
        <article className="panel">
          <h3 className="font-medium">Application updates</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Channel: stable · {updateState}
          </p>
          <label className="check-field mt-3">
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={(event) => setAutoCheck(event.target.checked)}
            />
            Check automatically
          </label>
          <div className="mt-4 flex gap-2">
            <button
              className="button-secondary"
              onClick={() => void checkUpdate()}
            >
              Check now
            </button>
            <button
              className="button-primary"
              onClick={() => void downloadUpdate()}
            >
              Download update
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Unsigned apply falls back to the GitHub Release page after
            confirmation.
          </p>
        </article>
        <article className="panel">
          <h3 className="font-medium">Logs</h3>
          <input
            className="input mt-3"
            aria-label="Log level filter"
            placeholder="Filter lines"
            value={logFilter}
            onChange={(event) => setLogFilter(event.target.value)}
          />
          <pre className="log-viewer mt-3">
            {filteredLogs.length
              ? filteredLogs.join("\n")
              : "No matching log lines."}
          </pre>
          <p className="mt-2 text-xs text-zinc-500">
            State folder access remains a narrow native operation; no generic
            filesystem RPC is exposed.
          </p>
        </article>
      </div>
      <article className="panel mt-6">
        <h3 className="font-medium">About BrowserLogin 0.1.0</h3>
        <p className="mt-2 text-sm text-zinc-500">
          Business Source License summary · third-party notices · system theme ·
          no telemetry.
        </p>
      </article>
      <p className="mt-4 text-sm" role="status">
        {message}
      </p>
    </section>
  );
}
