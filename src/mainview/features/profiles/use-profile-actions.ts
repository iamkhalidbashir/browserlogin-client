import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBridge, type BridgeResult } from "../../rpc-client.js";
import type { ProfileAction } from "./profile-table.js";

type Profile = BridgeResult<"profilesList">[number];

export function useProfileActions(profiles: readonly Profile[] | undefined) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [pendingActions, setPendingActions] = useState<
    Record<string, ProfileAction>
  >({});
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [forceStopTargetId, setForceStopTargetId] = useState<string | null>(
    null,
  );
  const [forceStopText, setForceStopText] = useState("");
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
  };
  const closeForceStop = () => {
    setForceStopTargetId(null);
    setForceStopText("");
  };

  const stopProfile = async (profileId: string) => {
    setPending(profileId, "stop");
    try {
      const result = await bridge.request("sessionsStop", { profileId });
      if (result.ok)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profiles"] }),
          queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        ]);
    } finally {
      clearPending(profileId);
    }
  };
  const forceStopProfile = async () => {
    if (!forceStopTarget) return;
    const profileId = forceStopTarget.id;
    setPending(profileId, "force-stop");
    try {
      const result = await bridge.request("sessionsForceStop", {
        profileId,
        confirmation: forceStopText,
      });
      if (result.ok) {
        closeForceStop();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profiles"] }),
          queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        ]);
      }
    } finally {
      clearPending(profileId);
    }
  };
  const deleteProfile = async () => {
    if (!deleteTarget) return;
    const profileId = deleteTarget.id;
    setPending(profileId, "delete");
    try {
      const result = await bridge.request("profilesDelete", { profileId });
      if (result.ok) {
        closeDelete();
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      }
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
    deleteTarget,
    deleteText,
    setDeleteText,
    openDelete: (profileId: string) => {
      setDeleteTargetId(profileId);
      setDeleteText("");
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
