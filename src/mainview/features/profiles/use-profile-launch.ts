import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeErrorMessage } from "../../../shared/redaction.js";
import { useBridge, type BridgeResult } from "../../rpc-client.js";

type Profile = BridgeResult<"profilesList">[number];

export type ProfileLaunchFeedback =
  | {
      readonly state: "pending";
      readonly role: "status";
      readonly code: "";
      readonly completed: 0;
      readonly message: string;
    }
  | {
      readonly state: "success";
      readonly role: "status";
      readonly code: "";
      readonly completed: number;
      readonly message: string;
    }
  | {
      readonly state: "error";
      readonly role: "alert";
      readonly code: string;
      readonly completed: number;
      readonly message: string;
    };

function launchFailureDetail(value: string | Error): string {
  const detail = safeErrorMessage(value).replace(/^[a-z]/, (letter) =>
    letter.toUpperCase(),
  );
  return /[.!?]$/.test(detail) ? detail : `${detail}.`;
}

export function useProfileLaunch(profiles: readonly Profile[] | undefined) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [launchActions, setLaunchActions] = useState<
    Readonly<Record<string, "launch">>
  >({});
  const [feedback, setFeedback] = useState<ProfileLaunchFeedback | null>(null);

  const launch = async (profileIds: readonly string[]) => {
    const launchedIds = new Set(profileIds);
    const profileNames = profileIds.map((profileId, index) => {
      const name = profiles?.find((profile) => profile.id === profileId)?.name;
      return name ? safeErrorMessage(name) : `Selected profile ${index + 1}`;
    });
    const target = profileNames.join(", ");
    let completed = 0;
    const refreshStartedProfiles = async () => {
      if (completed === 0) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      ]);
    };

    setLaunchActions((current) => ({
      ...current,
      ...Object.fromEntries(
        profileIds.map((profileId) => [profileId, "launch"] as const),
      ),
    }));
    setFeedback({
      state: "pending",
      role: "status",
      code: "",
      completed: 0,
      message: `Starting ${profileIds.length} profile${profileIds.length === 1 ? "" : "s"}: ${target}.`,
    });

    try {
      const binary = await bridge.request("binaryStatus", {});
      if (!binary.ok) {
        const code = safeErrorMessage(binary.error.code);
        const detail = launchFailureDetail(binary.error.message);
        setFeedback({
          state: "error",
          role: "alert",
          code,
          completed,
          message: `Profile launch failed before start (${code}): ${detail} Check the runtime status and try again.`,
        });
        return;
      }
      if (binary.value === null) {
        setFeedback({
          state: "error",
          role: "alert",
          code: "RUNTIME_REQUIRED",
          completed,
          message:
            "Profile launch requires an active CloakBrowser runtime. Install or restore the runtime, then try again.",
        });
        return;
      }
      for (const profileId of profileIds) {
        const result = await bridge.request("sessionsStart", { profileId });
        if (!result.ok) {
          await refreshStartedProfiles();
          const code = safeErrorMessage(result.error.code);
          const detail = launchFailureDetail(result.error.message);
          setFeedback({
            state: "error",
            role: "alert",
            code,
            completed,
            message: `${completed} of ${profileIds.length} profiles started. Launch error (${code}): ${detail} Check the affected profile and try again.`,
          });
          return;
        }
        completed += 1;
      }
      await refreshStartedProfiles();
      setFeedback({
        state: "success",
        role: "status",
        code: "",
        completed,
        message: `Started ${completed} profile${completed === 1 ? "" : "s"}: ${target}. Live sessions are up to date.`,
      });
    } catch (error) {
      await refreshStartedProfiles();
      const code = "TRANSPORT_ERROR";
      const detail = launchFailureDetail(
        error instanceof Error ? error : "Profile launch request failed.",
      );
      setFeedback({
        state: "error",
        role: "alert",
        code,
        completed,
        message: `${completed} of ${profileIds.length} profiles started. Transport error (${code}): ${detail} Check the connection and try again.`,
      });
    } finally {
      setLaunchActions((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([profileId]) => !launchedIds.has(profileId),
          ),
        ),
      );
    }
  };

  return { launch, launchActions, feedback } as const;
}
