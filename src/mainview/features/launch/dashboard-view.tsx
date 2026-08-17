import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";

export default function DashboardView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const result = await bridge.request("sessionsLive", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    refetchInterval: 10_000,
  });
  const stop = async (profileId: string, force: boolean) => {
    if (force)
      await bridge.request("sessionsForceStop", {
        profileId,
        confirmation,
      });
    else await bridge.request("sessionsStop", { profileId });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };
  return (
    <section>
      <p className="eyebrow">Workspace</p>
      <h2 className="text-3xl font-semibold">Dashboard</h2>
      <p className="mt-2 text-zinc-500">
        Monitor local sessions and archive-preserving stop operations.
      </p>
      <div className="panel mt-6">
        <h3 className="font-medium">Live sessions</h3>
        {sessions.data?.length ? (
          <div className="mt-4 space-y-4">
            {sessions.data.map((session) => {
              const profileId = String(session.profile_id);
              const phrase = `FORCE CLOSE ${profileId}`;
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
                      onClick={() => void stop(profileId, false)}
                    >
                      Stop and archive
                    </button>
                    <input
                      className="input max-w-xs"
                      aria-label={`Force confirmation ${profileId}`}
                      placeholder={phrase}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <button
                      className="button-danger"
                      disabled={confirmation !== phrase}
                      onClick={() => void stop(profileId, true)}
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
    </section>
  );
}
