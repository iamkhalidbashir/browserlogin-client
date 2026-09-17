import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import logoUrl from "../../../../resources/icons/browserlogin.png";

type SetupStatus =
  | { readonly state: "pending" | "required" }
  | { readonly state: "error"; readonly message: string };

type SetupViewProps = {
  readonly status: SetupStatus;
  readonly onRetryStatus: () => void;
} & (
  | { readonly step: "connection" }
  | { readonly step: "runtime"; readonly hasLicense: boolean }
);

export default function SetupView(props: SetupViewProps) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [appOrigin, setAppOrigin] = useState(
    "https://example-1.app-csite-env.sapps.co",
  );
  const [apiKey, setApiKey] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [licenseStored, setLicenseStored] = useState(
    props.step === "runtime" && props.hasLicense,
  );
  const progress = useQuery({
    queryKey: ["binary-progress"],
    enabled: downloadPending,
    queryFn: async () => {
      const result = await bridge.request("binaryProgress", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    refetchInterval: downloadPending ? 250 : false,
  });
  const saveConnection = async () => {
    setBusy(true);
    try {
      const saved = await bridge.request("connectionSet", {
        appOrigin,
        apiKey,
      });
      if (!saved.ok) setMessage(saved.error.message);
      else {
        await queryClient.invalidateQueries({ queryKey: ["connection"] });
        setApiKey("");
        const tested = await bridge.request("connectionTest", {});
        setMessage(
          tested.ok && tested.value.connected
            ? "Connection verified."
            : "Connection could not be verified.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Connection request failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const hasStoredLicense =
    props.step === "runtime" && (props.hasLicense || licenseStored);
  const runtimeButtonLabel = downloadPending
    ? "Installing…"
    : busy
      ? "Saving license…"
      : downloadFailed && hasStoredLicense
        ? "Retry download"
        : "Install CloakBrowser";
  const installRuntime = async () => {
    if (props.step !== "runtime") return;
    setBusy(true);
    setDownloadFailed(false);
    try {
      if (!hasStoredLicense) {
        const saved = await bridge
          .request("licenseSet", { licenseKey })
          .finally(() => setLicenseKey(""));
        if (!saved.ok) {
          setMessage(saved.error.message);
          return;
        }
        setLicenseStored(true);
        await queryClient.invalidateQueries({ queryKey: ["connection"] });
      }
      setDownloadPending(true);
      setMessage("Downloading and verifying CloakBrowser…");
      const downloaded = await bridge.request("binaryDownload", {
        advancedEnabled: false,
        source: "license",
      });
      if (!downloaded.ok) {
        setDownloadFailed(true);
        setMessage(downloaded.error.message);
        return;
      }
      setMessage("CloakBrowser installed. Confirming the active runtime…");
      await queryClient.invalidateQueries({ queryKey: ["binary"] });
    } catch (error) {
      setDownloadFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Runtime request failed.",
      );
    } finally {
      setDownloadPending(false);
      setBusy(false);
    }
  };

  let content: ReactNode;
  switch (props.status.state) {
    case "pending":
      content = (
        <p className="mt-6 text-sm" role="status">
          Checking {props.step === "connection" ? "connection" : "runtime"}{" "}
          status…
        </p>
      );
      break;
    case "error":
      content = (
        <div className="mt-6">
          <p className="text-sm text-red-600" role="alert">
            {props.status.message}
          </p>
          <button
            className="button-secondary mt-4"
            onClick={props.onRetryStatus}
          >
            Retry status
          </button>
        </div>
      );
      break;
    case "required":
      switch (props.step) {
        case "connection":
          content = (
            <>
              <label className="field mt-6">
                <span>Application origin</span>
                <input
                  value={appOrigin}
                  onChange={(event) => setAppOrigin(event.target.value)}
                />
              </label>
              <label className="field mt-4">
                <span>API key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <button
                className="button-primary mt-5"
                disabled={busy || !apiKey}
                onClick={() => void saveConnection()}
              >
                {busy ? "Saving…" : "Save and test"}
              </button>
              <p className="mt-4 text-sm" role="status">
                {message || "Enter the connection used by this desktop client."}
              </p>
            </>
          );
          break;
        case "runtime":
          content = (
            <>
              {!hasStoredLicense ? (
                <label className="field mt-6">
                  <span>License key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={licenseKey}
                    onChange={(event) => setLicenseKey(event.target.value)}
                  />
                </label>
              ) : (
                <p className="mt-6 text-sm text-zinc-500">
                  License stored in the native keychain.
                </p>
              )}
              <button
                className="button-primary mt-5"
                disabled={busy || (!hasStoredLicense && !licenseKey)}
                onClick={() => void installRuntime()}
              >
                {runtimeButtonLabel}
              </button>
              {downloadPending ? (
                <progress
                  aria-label="CloakBrowser download progress"
                  className="runtime-progress mt-4 w-full"
                  max={progress.data?.total ?? undefined}
                  value={
                    progress.data?.total === null
                      ? undefined
                      : progress.data?.downloaded
                  }
                />
              ) : null}
              <p
                className={
                  downloadFailed ? "mt-4 text-sm text-red-600" : "mt-4 text-sm"
                }
                role={downloadFailed ? "alert" : "status"}
              >
                {message || "Enter the license used for this desktop runtime."}
              </p>
            </>
          );
          break;
        default:
          return props satisfies never;
      }
      break;
    default:
      return props.status satisfies never;
  }

  return (
    <main className="setup-shell grid min-h-screen place-items-center bg-zinc-50 p-6 text-zinc-950">
      <section className="panel w-full max-w-xl">
        <div className="flex items-center gap-3">
          <img
            src={logoUrl}
            alt="BrowserLogin logo"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          <p className="eyebrow">First run</p>
        </div>
        <h1 className="text-3xl font-semibold">
          {props.step === "connection"
            ? "Connect BrowserLogin"
            : "Install CloakBrowser"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {props.step === "connection"
            ? "Navigation remains locked until the client credential is stored in the native keychain."
            : "Navigation remains locked until the licensed browser runtime is installed and verified."}
        </p>
        {content}
      </section>
    </main>
  );
}
