import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import { ForceStopConfirmation } from "../profiles/force-stop-confirmation.js";

export default function DashboardView({
  title = "Dashboard",
}: {
  title?: string;
}) {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [forceStopProfileId, setForceStopProfileId] = useState<string | null>(
    null,
  );
  const [forceStopText, setForceStopText] = useState("");
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const result = await bridge.request("sessionsLive", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    refetchInterval: 10_000,
  });
  const stop = async (profileId: string) => {
    await bridge.request("sessionsStop", { profileId });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };
  const forceStop = async () => {
    if (!forceStopProfileId) return;
    const profileId = forceStopProfileId;
    setPendingProfileId(profileId);
    try {
      const result = await bridge.request("sessionsForceStop", {
        profileId,
        confirmation: forceStopText,
      });
      if (result.ok) {
        setForceStopProfileId(null);
        setForceStopText("");
      }
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } finally {
      setPendingProfileId(null);
    }
  };
  return (
    <section>
      <p className="eyebrow">Workspace</p>
      <h2 className="text-3xl font-semibold">{title}</h2>
      <p className="mt-2 text-zinc-500">
        Monitor local sessions and archive-preserving stop operations.
      </p>
      <div className="panel mt-6">
        <h3 className="font-medium">Live sessions</h3>
        {sessions.data?.length ? (
          <div className="mt-4 space-y-4">
            {sessions.data.map((session) => {
              const profileId = String(session.profile_id);
              return (
                <article key={profileId} className="session-row">
                  <div>
                    <strong>{profileId}</strong>
                    <p className="text-sm text-zinc-500">
                      {String(session.status)} · archive generation{" "}
                      {String(session.archive_generation ?? 0)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button-secondary"
                      onClick={() => void stop(profileId)}
                    >
                      Stop and archive
                    </button>
                    <button
                      className="button-danger"
                      disabled={pendingProfileId === profileId}
                      onClick={() => {
                        setForceStopProfileId(profileId);
                        setForceStopText("");
                      }}
                    >
                      Force stop
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No local sessions are running.
          </p>
        )}
      </div>
      {forceStopProfileId ? (
        <ForceStopConfirmation
          profileId={forceStopProfileId}
          confirmation={forceStopText}
          pending={pendingProfileId === forceStopProfileId}
          onConfirmationChange={setForceStopText}
          onClose={() => {
            setForceStopProfileId(null);
            setForceStopText("");
          }}
          onConfirm={() => void forceStop()}
        />
      ) : null}
    </section>
  );
}
