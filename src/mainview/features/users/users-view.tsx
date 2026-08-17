import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";

export default function UsersView() {
  const bridge = useBridge();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("viewer");
  const [message, setMessage] = useState("");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const result = await bridge.request("usersList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const members = useQuery({
    queryKey: ["members", "profile-1"],
    queryFn: async () => {
      const result = await bridge.request("membersList", {
        profileId: "profile-1",
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const owner = Boolean(users.data?.[0]?.owner);
  const disable = async () => {
    const result = await bridge.request("usersDisable", { userId: "user-1" });
    setMessage(
      result.ok
        ? "User disabled; their sessions are force-stopped."
        : result.error.message,
    );
    setConfirmDisable(false);
  };
  const share = async () => {
    const result = await bridge.request("membersShare", {
      profileId: "profile-1",
      userId: "user-1",
      role: shareRole,
    });
    setMessage(result.ok ? "Profile shared." : result.error.message);
  };
  return (
    <section>
      <p className="eyebrow">Workspace</p>
      <h2 className="text-3xl font-semibold">Users</h2>
      <p className="mt-2 text-zinc-500">
        Owner-gated workspace and profile membership controls.
      </p>
      <div className="panel mt-6">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.status}</td>
                <td>{user.owner ? "Owner" : "Member"}</td>
                <td>
                  {owner ? (
                    <button
                      className="table-action"
                      onClick={() => setConfirmDisable(true)}
                    >
                      Disable user
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {confirmDisable ? (
          <div className="conflict-banner" role="alert">
            <p>Disabling this user force-stops all of their active sessions.</p>
            <button
              className="button-danger mt-2"
              onClick={() => void disable()}
            >
              Confirm disable
            </button>
          </div>
        ) : null}
      </div>
      <div className="panel mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Profile members</h3>
            <p className="text-sm text-zinc-500">Research profile</p>
          </div>
          {owner ? (
            <div className="flex gap-2">
              <select
                className="input"
                aria-label="Share role"
                value={shareRole}
                onChange={(event) =>
                  setShareRole(event.target.value as "editor" | "viewer")
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button className="button-secondary" onClick={() => void share()}>
                Share profile
              </button>
            </div>
          ) : null}
        </div>
        <ul className="mt-4 space-y-2">
          {members.data?.map((member) => (
            <li
              key={member.id}
              className="flex justify-between border-t border-zinc-800 pt-3"
            >
              <span>
                {member.name} · {member.email} · {member.role}
              </span>
              {owner ? (
                <button
                  className="table-action"
                  onClick={() =>
                    void bridge.request("membersRemove", {
                      profileId: "profile-1",
                      userId: member.id,
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-sm" role="status">
        {message}
      </p>
    </section>
  );
}
