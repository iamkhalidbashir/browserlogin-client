import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import {
  EMPTY_PROXY_FORM,
  ProxyEditor,
  type ProxyForm,
} from "./proxy-editor.js";

export default function ProxiesView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ProxyForm>(EMPTY_PROXY_FORM);
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
  const openCreate = () => {
    setForm(EMPTY_PROXY_FORM);
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["proxies"] }),
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      ]);
      setEditing(false);
      setEditingId(null);
    }
  };
  const changeIp = async (proxyId: string) => {
    const result = await bridge.request("proxiesChangeIp", { proxyId });
    setMessage(
      result.ok
        ? result.value.ip_verified && result.value.ip
          ? `Proxy IP changed to ${result.value.ip}`
          : "Proxy rotation acknowledged; new IP could not be verified."
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
      {proxies.isPending || users.isPending ? (
        <div className="panel mt-6" role="status">
          Loading proxies...
        </div>
      ) : proxies.isError || users.isError ? (
        <div className="panel mt-6" role="alert">
          <h3 className="font-medium">Could not load proxies</h3>
          <p className="mt-2 text-sm text-zinc-500">
            {proxies.error?.message ??
              users.error?.message ??
              "Proxy data could not be loaded."}
          </p>
          <button
            className="button-secondary mt-4"
            onClick={() => {
              void proxies.refetch();
              void users.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : proxies.data.length === 0 ? (
        <div className="panel mt-6">
          <h3 className="font-medium">No proxies yet</h3>
          <p className="mt-2 text-sm text-zinc-500">
            {owner
              ? "Create a proxy to route profiles through a managed network endpoint."
              : "Ask a workspace owner to create a proxy for this workspace."}
          </p>
          {owner ? (
            <button className="button-primary mt-4" onClick={openCreate}>
              Create proxy
            </button>
          ) : null}
        </div>
      ) : (
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
              {proxies.data.map((proxy) => (
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
      )}
      <p className="mt-3 text-sm" role="status">
        {message}
      </p>
      {editing ? (
        <ProxyEditor
          editingId={editingId}
          form={form}
          onChange={setForm}
          onClose={() => {
            setEditing(false);
            setEditingId(null);
          }}
          onSave={() => void save()}
        />
      ) : null}
    </section>
  );
}
