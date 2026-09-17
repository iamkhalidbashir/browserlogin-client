import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeErrorMessage } from "../../../shared/redaction.js";
import { useBridge, type BridgeResult } from "../../rpc-client.js";
import type { ProfileAction } from "./profile-table.js";

type Profile = BridgeResult<"profilesList">[number];

export type ProfileLifecycleFailure = Readonly<{
  profileId: string;
  action: "stop" | "force-stop";
  code: string;
  message: string;
}>;

export type ProfileLifecycleFailures = Readonly<
  Record<string, ProfileLifecycleFailure>
>;

export function useProfileActions(profiles: readonly Profile[] | undefined) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [pendingActions, setPendingActions] = useState<
    Record<string, ProfileAction>
  >({});
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [forceStopTargetId, setForceStopTargetId] = useState<string | null>(
    null,
  );
  const [forceStopText, setForceStopText] = useState("");
  const [lifecycleFailures, setLifecycleFailures] =
    useState<ProfileLifecycleFailures>({});
  const deleteTarget = profiles?.find(
    (profile) => profile.id === deleteTargetId,
  );
  const forceStopTarget = profiles?.find(
    (profile) => profile.id === forceStopTargetId,
  );

  const setPending = (profileId: string, action: ProfileAction) => {
    setPendingActions((current) => ({ ...current, [profileId]: action }));
  };
  const clearPending = (profileId: string) => {
    setPendingActions((current) => {
      const next = { ...current };
      delete next[profileId];
      return next;
    });
  };
  const closeDelete = () => {
    setDeleteTargetId(null);
    setDeleteText("");
    setDeleteError(null);
  };
  const closeForceStop = () => {
    setForceStopTargetId(null);
    setForceStopText("");
  };
  const clearLifecycleFailure = (profileId: string) => {
    setLifecycleFailures((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => id !== profileId),
      ),
    );
  };
  const reportLifecycleFailure = (
    profileId: string,
    action: ProfileLifecycleFailure["action"],
    code: string,
    value: string | Error,
  ) => {
    const failure = {
      profileId,
      action,
      code: safeErrorMessage(code),
      message: safeErrorMessage(value),
    } satisfies ProfileLifecycleFailure;
    setLifecycleFailures((current) => ({
      ...current,
      [profileId]: failure,
    }));
    console.error("Profile lifecycle action failed", failure);
  };

  const stopProfile = async (profileId: string) => {
    setPending(profileId, "stop");
    clearLifecycleFailure(profileId);
    try {
      const result = await bridge.request("sessionsStop", { profileId });
      if (!result.ok) {
        reportLifecycleFailure(
          profileId,
          "stop",
          result.error.code,
          result.error.message,
        );
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      ]);
    } catch (error) {
      reportLifecycleFailure(
        profileId,
        "stop",
        "TRANSPORT_ERROR",
        error instanceof Error ? error : "Profile stop request failed.",
      );
    } finally {
      clearPending(profileId);
    }
  };
  const forceStopProfile = async () => {
    if (!forceStopTarget) return;
    const profileId = forceStopTarget.id;
    setPending(profileId, "force-stop");
    clearLifecycleFailure(profileId);
    try {
      const result = await bridge.request("sessionsForceStop", {
        profileId,
        confirmation: forceStopText,
      });
      if (!result.ok) {
        reportLifecycleFailure(
          profileId,
          "force-stop",
          result.error.code,
          result.error.message,
        );
        return;
      }
      closeForceStop();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      ]);
    } catch (error) {
      reportLifecycleFailure(
        profileId,
        "force-stop",
        "TRANSPORT_ERROR",
        error instanceof Error ? error : "Profile force close request failed.",
      );
    } finally {
      clearPending(profileId);
    }
  };
  const deleteProfile = async () => {
    if (!deleteTarget) return;
    const profileId = deleteTarget.id;
    setDeleteError(null);
    setPending(profileId, "delete");
    try {
      const result = await bridge.request("profilesDelete", { profileId });
      if (!result.ok) {
        const code = safeErrorMessage(result.error.code);
        const detail = safeErrorMessage(result.error.message);
        setDeleteError(`Delete failed (${code}): ${detail}`);
        return;
      }
      closeDelete();
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } catch (error) {
      const detail = safeErrorMessage(
        error instanceof Error ? error : "Profile deletion request failed.",
      );
      setDeleteError(`Delete failed (TRANSPORT_ERROR): ${detail}`);
    } finally {
      clearPending(profileId);
    }
  };
  const rotateProfileProxy = async (profileId: string) => {
    const profile = profiles?.find((candidate) => candidate.id === profileId);
    if (!profile?.proxy) return;
    setPending(profileId, "rotate");
    try {
      await bridge.request("proxiesChangeIp", { proxyId: profile.proxy.id });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["proxies"] });
    } finally {
      clearPending(profileId);
    }
  };

  return {
    pendingActions,
    lifecycleFailures,
    deleteTarget,
    deleteText,
    deleteError,
    setDeleteText,
    openDelete: (profileId: string) => {
      setDeleteTargetId(profileId);
      setDeleteText("");
      setDeleteError(null);
    },
    closeDelete,
    deleteProfile,
    forceStopTarget,
    forceStopText,
    setForceStopText,
    openForceStop: (profileId: string) => {
      setForceStopTargetId(profileId);
      setForceStopText("");
    },
    closeForceStop,
    forceStopProfile,
    stopProfile,
    rotateProfileProxy,
  };
}
