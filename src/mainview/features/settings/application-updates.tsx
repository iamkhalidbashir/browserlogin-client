import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { safeErrorMessage } from "../../../shared/redaction.js";
import { useBridge, type BridgeResult } from "../../rpc-client.js";

type UpdateResult = NonNullable<BridgeResult<"updatesCheck">>;

type UpdateViewState =
  | { readonly phase: "checking" | "downloading" | "installing" }
  | { readonly phase: "unchecked" }
  | { readonly phase: "result"; readonly value: UpdateResult }
  | { readonly phase: "error"; readonly message: string };

function resultState(value: UpdateResult | null): UpdateViewState {
  return value ? { phase: "result", value } : { phase: "unchecked" };
}

function statusText(state: UpdateViewState): string {
  switch (state.phase) {
    case "checking":
      return "Checking…";
    case "downloading":
      return "Downloading…";
    case "installing":
      return "Installing and restarting…";
    case "unchecked":
      return "Not checked";
    case "error":
      return state.message;
    case "result":
      if (state.value.error) return state.value.error;
      if (state.value.updateReady) return "Ready to install";
      if (state.value.updateAvailable)
        return state.value.version
          ? `Version ${state.value.version} available`
          : "Update available";
      return "Current";
  }
}

function requestFailure(error: unknown, fallback: string): UpdateViewState {
  return {
    phase: "error",
    message: safeErrorMessage(error instanceof Error ? error : fallback),
  };
}

export function ApplicationUpdates({
  autoCheckUpdates,
}: {
  readonly autoCheckUpdates: boolean | null;
}) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [autoCheck, setAutoCheck] = useState<boolean | null>(autoCheckUpdates);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [actionState, setActionState] = useState<UpdateViewState | null>(null);
  const latest = useQuery({
    queryKey: ["updates-latest"],
    retry: false,
    queryFn: async () => {
      const result = await bridge.request("updatesCheck", { mode: "latest" });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });

  useEffect(() => setAutoCheck(autoCheckUpdates), [autoCheckUpdates]);

  const saveAutoCheck = async (checked: boolean) => {
    const previous = autoCheck;
    setAutoCheck(checked);
    setSavingPreference(true);
    setPreferenceError("");
    try {
      await queryClient.cancelQueries({ queryKey: ["settings"], exact: true });
      const result = await bridge.request("settingsSet", {
        autoCheckUpdates: checked,
      });
      if (!result.ok) {
        setAutoCheck(previous);
        setPreferenceError(result.error.message);
        return;
      }
      setAutoCheck(result.value.auto_check_updates);
      queryClient.setQueryData(["settings"], result.value);
    } catch (error) {
      setAutoCheck(previous);
      setPreferenceError(
        safeErrorMessage(
          error instanceof Error
            ? error
            : "Automatic update preference could not be saved.",
        ),
      );
    } finally {
      setSavingPreference(false);
    }
  };

  const checkUpdate = async () => {
    setActionState({ phase: "checking" });
    try {
      const result = await bridge.request("updatesCheck", { mode: "refresh" });
      if (result.ok) queryClient.setQueryData(["updates-latest"], result.value);
      setActionState(
        result.ok
          ? resultState(result.value)
          : { phase: "error", message: result.error.message },
      );
    } catch (error) {
      setActionState(requestFailure(error, "Update check failed"));
    }
  };

  const downloadUpdate = async () => {
    setActionState({ phase: "downloading" });
    try {
      const result = await bridge.request("updatesDownload", {});
      if (result.ok) queryClient.setQueryData(["updates-latest"], result.value);
      setActionState(
        result.ok
          ? { phase: "result", value: result.value }
          : { phase: "error", message: result.error.message },
      );
    } catch (error) {
      setActionState(requestFailure(error, "Update download failed"));
    }
  };

  const installUpdate = async () => {
    setActionState({ phase: "installing" });
    try {
      const result = await bridge.request("updatesApply", { confirmed: true });
      if (!result.ok)
        setActionState({ phase: "error", message: result.error.message });
      else {
        queryClient.setQueryData(["updates-latest"], result.value);
        if (result.value.error)
          setActionState({ phase: "result", value: result.value });
      }
    } catch (error) {
      setActionState(requestFailure(error, "Update installation failed"));
    }
  };

  const update =
    actionState ??
    (latest.isPending
      ? ({ phase: "checking" } satisfies UpdateViewState)
      : latest.isError
        ? requestFailure(latest.error, "Update status could not be loaded.")
        : resultState(latest.data));
  const result = update.phase === "result" ? update.value : null;
  const busy =
    update.phase === "checking" ||
    update.phase === "downloading" ||
    update.phase === "installing";
  const updateError =
    update.phase === "error" ||
    (update.phase === "result" && Boolean(update.value.error));

  return (
    <article className="panel">
      <h3 className="font-medium">Application updates</h3>
      <p
        className={`mt-1 text-sm ${updateError ? "text-red-600" : "text-zinc-600"}`}
        aria-live={updateError ? "assertive" : "polite"}
        aria-atomic="true"
        {...(updateError ? { role: "alert" as const } : {})}
      >
        Channel: stable · {statusText(update)}
      </p>
      <label className="check-field mt-3">
        <input
          type="checkbox"
          checked={autoCheck ?? false}
          disabled={autoCheck === null || savingPreference}
          onChange={(event) => void saveAutoCheck(event.target.checked)}
        />
        Check automatically when BrowserLogin starts
      </label>
      {preferenceError ? (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {preferenceError}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="button-secondary"
          disabled={busy}
          onClick={() => void checkUpdate()}
        >
          Check now
        </button>
        <button
          className="button-primary"
          disabled={
            busy ||
            !result?.updateAvailable ||
            result.updateReady ||
            Boolean(result.error)
          }
          onClick={() => void downloadUpdate()}
        >
          Download update
        </button>
        {result?.updateReady && !result.error ? (
          <button
            className="button-primary"
            onClick={() => void installUpdate()}
          >
            Install and restart
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-zinc-600">
        Automatic checks never download or install an update. Those actions stay
        explicit.
      </p>
    </article>
  );
}
