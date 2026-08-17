import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";

export default function ProxiesView() {
  const bridge = useBridge();
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    protocol: "http" as "http" | "socks5",
    host: "",
    port: 8080,
    username: "",
    password: "",
    change_ip_url: "",
  });
  const proxies = useQuery({
    queryKey: ["proxies"],
    queryFn: async () => {
      const result = await bridge.request("proxiesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const users = useQuery({
    queryKey: ["users", "proxy-role"],
    queryFn: async () => {
      const result = await bridge.request("usersList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const owner = Boolean(users.data?.[0]?.owner);
  const blank = {
    name: "",
    protocol: "http" as "http" | "socks5",
    host: "",
    port: 8080,
    username: "",
    password: "",
    change_ip_url: "",
  };
  const openCreate = () => {
    setForm(blank);
    setEditingId(null);
    setEditing(true);
  };
  const openEdit = (proxyId: string) => {
    const current = proxies.data?.find((proxy) => proxy.id === proxyId);
    if (!current) return;
    setForm({
      name: current.name,
      protocol: current.protocol,
      host: current.host,
      port: current.port,
      username: current.username ?? "",
      password: "",
      change_ip_url: current.change_ip_url ?? "",
    });
    setEditingId(current.id);
    setEditing(true);
  };
  const save = async () => {
    const fields = {
      name: form.name,
      protocol: form.protocol,
      host: form.host,
      port: form.port,
      username: form.username || null,
      password: form.password || null,
      change_ip_url: form.change_ip_url || null,
    };
    const result = editingId
      ? await bridge.request("proxiesUpdate", { proxyId: editingId, ...fields })
      : await bridge.request("proxiesCreate", fields);
    setForm({ ...form, password: "" });
    setMessage(result.ok ? "Proxy saved." : result.error.message);
    if (result.ok) {
      setEditing(false);
      setEditingId(null);
    }
  };
  const changeIp = async (proxyId: string) => {
    const result = await bridge.request("proxiesChangeIp", { proxyId });
    setMessage(
      result.ok
        ? `Proxy IP changed to ${result.value.ip}`
        : result.error.message,
    );
  };
  return (
    <section>
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2 className="text-3xl font-semibold">Proxies</h2>
          <p className="mt-2 text-zinc-500">
            Route profiles without exposing stored proxy passwords.
          </p>
        </div>
        {owner ? (
          <button className="button-primary" onClick={openCreate}>
            Add proxy
          </button>
        ) : null}
      </div>
      <div className="panel mt-6 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Protocol</th>
              <th>Host</th>
              <th>Username</th>
              <th>Last IP</th>
              <th>Password</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {proxies.data?.map((proxy) => (
              <tr key={proxy.id}>
                <td>{proxy.name}</td>
                <td>{proxy.protocol}</td>
                <td>
                  {proxy.host}:{proxy.port}
                </td>
                <td>{proxy.username ?? "—"}</td>
                <td>{proxy.last_ip ?? "Unknown"}</td>
                <td aria-label="Masked password">••••</td>
                <td>
                  {owner ? (
                    <>
                      <button
                        className="table-action"
                        onClick={() => void changeIp(proxy.id)}
                      >
                        Change IP
                      </button>{" "}
                      <button
                        className="table-action"
                        onClick={() => openEdit(proxy.id)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        className="table-action"
                        onClick={() =>
                          void bridge.request("proxiesDelete", {
                            proxyId: proxy.id,
                          })
                        }
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm" role="status">
        {message}
      </p>
      {editing ? (
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? "Edit proxy" : "Create proxy"}
        >
          <div className="drawer-card">
            <div className="flex justify-between">
              <h3 className="text-xl font-semibold">
                {editingId ? "Edit proxy" : "Create proxy"}
              </h3>
              <button
                className="table-action"
                onClick={() => {
                  setEditing(false);
                  setEditingId(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="form-grid mt-5">
              <label className="field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Protocol</span>
                <select
                  value={form.protocol}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      protocol: event.target.value as "http" | "socks5",
                    })
                  }
                >
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </label>
              <label className="field">
                <span>Host</span>
                <input
                  value={form.host}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Port</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={(event) =>
                    setForm({ ...form, port: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  value={form.username}
                  onChange={(event) =>
                    setForm({ ...form, username: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                />
              </label>
              <label className="field col-span-2">
                <span>Change IP URL</span>
                <input
                  value={form.change_ip_url}
                  onChange={(event) =>
                    setForm({ ...form, change_ip_url: event.target.value })
                  }
                />
              </label>
            </div>
            <button
              className="button-primary mt-5"
              disabled={!form.name || !form.host}
              onClick={() => void save()}
            >
              Save proxy
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
