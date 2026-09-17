import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBridge, type Bridge, type BridgeResult } from "../../rpc-client.js";
import type { ProfileAction } from "./profile-table.js";

export type TransferProgressSnapshot =
  BridgeResult<"sessionsTransferProgress">[number];
export type ProfileTransferProgress = Readonly<
  Record<string, TransferProgressSnapshot>
>;

export type TransferPresentation = Readonly<{
  label: string;
  accessibleName: string;
  valueText: string;
  percentage: number;
  state: TransferProgressSnapshot["status"];
}>;

const POLL_INTERVAL_MS = 250;

function expectedDirection(
  action: ProfileAction | undefined,
): TransferProgressSnapshot["direction"] | undefined {
  if (action === "launch") return "download";
  if (action === "stop") return "upload";
  return undefined;
}

export function hasPendingProfileTransfer(
  pendingActions: Readonly<Record<string, ProfileAction>>,
): boolean {
  return Object.values(pendingActions).some(
    (action) => expectedDirection(action) !== undefined,
  );
}

export function indexProfileTransferProgress(
  snapshots: readonly TransferProgressSnapshot[],
  pendingActions: Readonly<Record<string, ProfileAction>>,
): ProfileTransferProgress {
  return Object.fromEntries(
    snapshots
      .filter(
        (snapshot) =>
          expectedDirection(pendingActions[snapshot.profileId]) ===
          snapshot.direction,
      )
      .map((snapshot) => [snapshot.profileId, snapshot]),
  );
}

export function profileTransferProgressQueryOptions(
  bridge: Bridge,
  enabled: boolean,
) {
  const refetchInterval: number | false = enabled ? POLL_INTERVAL_MS : false;
  return {
    queryKey: ["profile-transfer-progress"] as const,
    enabled,
    refetchInterval,
    queryFn: async () => {
      const result = await bridge.request("sessionsTransferProgress", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}

export function transferPresentation(
  profileName: string,
  pendingAction: ProfileAction | undefined,
  snapshot: TransferProgressSnapshot | undefined,
): TransferPresentation | null {
  if (!snapshot) return null;
  const direction = expectedDirection(pendingAction);
  if (direction && direction !== snapshot.direction) return null;
  if (!direction && snapshot.status === "running") return null;

  const noun = snapshot.direction === "download" ? "Download" : "Upload";
  const active =
    snapshot.direction === "download" ? "Downloading" : "Uploading";
  const completed =
    snapshot.direction === "download" ? "Downloaded" : "Uploaded";
  const accessibleName = `${profileName} ${snapshot.direction} progress`;

  switch (snapshot.status) {
    case "running":
      return {
        label: `${active} ${snapshot.percentage}%`,
        accessibleName,
        valueText: `${snapshot.percentage}% ${snapshot.direction}ed`,
        percentage: snapshot.percentage,
        state: snapshot.status,
      };
    case "completed":
      return {
        label: `${completed} 100%`,
        accessibleName,
        valueText: `${noun} completed at 100%`,
        percentage: 100,
        state: snapshot.status,
      };
    case "failed":
      return {
        label: `${noun} failed at ${snapshot.percentage}%`,
        accessibleName,
        valueText: `${noun} failed at ${snapshot.percentage}%`,
        percentage: snapshot.percentage,
        state: snapshot.status,
      };
  }
}

export function useProfileTransferProgress(
  pendingActions: Readonly<Record<string, ProfileAction>>,
): ProfileTransferProgress {
  const bridge = useBridge();
  const activeActions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(pendingActions).filter(([, action]) =>
          expectedDirection(action),
        ),
      ),
    [pendingActions],
  );
  const activeSignature = JSON.stringify(
    Object.entries(activeActions).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const previousActions = useRef<Readonly<Record<string, ProfileAction>>>({});
  const [visibleProgress, setVisibleProgress] =
    useState<ProfileTransferProgress>({});
  const query = useQuery(
    profileTransferProgressQueryOptions(
      bridge,
      hasPendingProfileTransfer(pendingActions),
    ),
  );

  useEffect(() => {
    setVisibleProgress((current) => {
      const next = { ...current };
      for (const [profileId, action] of Object.entries(activeActions)) {
        if (previousActions.current[profileId] !== action)
          delete next[profileId];
      }
      for (const profileId of Object.keys(previousActions.current)) {
        if (activeActions[profileId] === undefined) {
          const snapshot = next[profileId];
          if (snapshot?.status === "running") delete next[profileId];
        }
      }
      return next;
    });
    previousActions.current = activeActions;
  }, [activeSignature]);

  useEffect(() => {
    if (!query.data) return;
    const indexed = indexProfileTransferProgress(query.data, activeActions);
    if (Object.keys(indexed).length === 0) return;
    setVisibleProgress((current) => ({ ...current, ...indexed }));
  }, [query.dataUpdatedAt]);

  return visibleProgress;
}
