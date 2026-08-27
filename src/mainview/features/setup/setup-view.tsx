import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import logoUrl from "../../../../resources/icons/browserlogin.png";

export default function SetupView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [appOrigin, setAppOrigin] = useState(
    "https://example-1.app-csite-env.sapps.co",
  );
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState(
    "Enter the connection used by this desktop client.",
  );
  const [busy, setBusy] = useState(false);
  const save = async () => {
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
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
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
        <h1 className="text-3xl font-semibold">Connect BrowserLogin</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Navigation remains locked until the client credential is stored in the
          native keychain.
        </p>
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
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save and test"}
        </button>
        <p className="mt-4 text-sm" role="status">
          {message}
        </p>
      </section>
    </main>
  );
}
