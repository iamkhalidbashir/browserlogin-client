import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";

export default function AuditNotesView() {
  const bridge = useBridge();
  const [profileFilter, setProfileFilter] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [notes, setNotes] = useState("Current profile note");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [message, setMessage] = useState("");
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const result = await bridge.request("profilesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const notesProfileId = selectedProfileId ?? profiles.data?.[0]?.id ?? null;
  const audit = useQuery({
    queryKey: ["audit", profileFilter],
    queryFn: async () => {
      const result = await bridge.request(
        "auditList",
        profileFilter ? { profileId: profileFilter } : {},
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const current = useQuery({
    queryKey: ["notes", notesProfileId],
    enabled: Boolean(notesProfileId),
    queryFn: async () => {
      if (!notesProfileId) throw new Error("No profile selected");
      const result = await bridge.request("notesGet", {
        profileId: notesProfileId,
      });
      if (!result.ok) throw new Error(result.error.message);
      setNotes(result.value.notes);
      return result.value;
    },
  });
  const history = useQuery({
    queryKey: ["notes-history", notesProfileId],
    enabled: Boolean(notesProfileId),
    queryFn: async () => {
      if (!notesProfileId) throw new Error("No profile selected");
      const result = await bridge.request("notesHistory", {
        profileId: notesProfileId,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const save = async () => {
    if (!notesProfileId) return;
    const params = {
      profileId: notesProfileId,
      notes,
      expectedVersion: current.data?.version ?? 0,
    };
    const result =
      mode === "append"
        ? await bridge.request("notesAppend", params)
        : await bridge.request("notesReplace", params);
    setMessage(
      result.ok
        ? `Notes saved at version ${result.value.version}.`
        : result.error.code === "CONFLICT"
          ? "Notes changed remotely. Reload latest before saving."
          : result.error.message,
    );
  };
  return (
    <section>
      <p className="eyebrow">Workspace</p>
      <h2 className="text-3xl font-semibold">Audit</h2>
      <p className="mt-2 text-zinc-500">
        Read-only activity plus version-aware profile notes.
      </p>
      <div className="panel mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Audit events</h3>
          <input
            className="input max-w-xs"
            aria-label="Audit profile filter"
            placeholder="Filter by profile ID"
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
          />
        </div>
        <table className="data-table mt-3">
          <thead>
            <tr>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {audit.data?.map((event, index) => (
              <tr key={`${event.entity_id}-${index}`}>
                <td>{event.action}</td>
                <td>
                  {event.entity_type}:{event.entity_id}
                </td>
                <td>{event.actor_user_id}</td>
                <td>{event.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Profile notes</h3>
          <div className="flex gap-2">
            <select
              className="input max-w-xs"
              aria-label="Notes profile"
              value={notesProfileId ?? ""}
              onChange={(event) =>
                setSelectedProfileId(event.target.value || null)
              }
            >
              {profiles.data?.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <select
              className="input max-w-xs"
              aria-label="Notes save mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "append" | "replace")
              }
            >
              <option value="append">Append</option>
              <option value="replace">Replace</option>
            </select>
          </div>
        </div>
        <textarea
          className="input mt-4 min-h-32"
          aria-label="Profile notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <button className="button-primary mt-3" onClick={() => void save()}>
          Save notes
        </button>
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
        <div className="mt-5">
          <h4 className="text-sm font-medium">History</h4>
          {history.data?.map((version) => (
            <details
              key={version.id}
              className="mt-2 border-t border-zinc-800 pt-2"
            >
              <summary>
                Version {version.version} · {version.created_by} ·{" "}
                {version.created_at}
              </summary>
              <p className="mt-2 text-sm text-zinc-500">{version.notes}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
