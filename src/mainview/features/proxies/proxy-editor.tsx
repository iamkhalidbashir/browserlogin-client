import { ModalDialog } from "../../components/modal-dialog.js";

export type ProxyForm = {
  readonly name: string;
  readonly protocol: "http" | "socks5";
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly change_ip_url: string;
};

export const EMPTY_PROXY_FORM: ProxyForm = {
  name: "",
  protocol: "http",
  host: "",
  port: 8080,
  username: "",
  password: "",
  change_ip_url: "",
};

type ProxyEditorProps = {
  readonly editingId: string | null;
  readonly form: ProxyForm;
  readonly onChange: (form: ProxyForm) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
};

export function ProxyEditor({
  editingId,
  form,
  onChange,
  onClose,
  onSave,
}: ProxyEditorProps) {
  return (
    <ModalDialog
      title={editingId ? "Edit proxy" : "Create proxy"}
      size="wide"
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            data-modal-autofocus
            value={form.name}
            onChange={(event) =>
              onChange({ ...form, name: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Protocol</span>
          <select
            value={form.protocol}
            onChange={(event) =>
              onChange({
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
              onChange({ ...form, host: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Port</span>
          <input
            type="number"
            value={form.port}
            onChange={(event) =>
              onChange({ ...form, port: Number(event.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            value={form.username}
            onChange={(event) =>
              onChange({ ...form, username: event.target.value })
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
              onChange({ ...form, password: event.target.value })
            }
          />
        </label>
        <label className="field col-span-2">
          <span>Change IP URL</span>
          <input
            value={form.change_ip_url}
            onChange={(event) =>
              onChange({ ...form, change_ip_url: event.target.value })
            }
          />
        </label>
      </div>
      <button
        className="button-primary mt-5"
        disabled={!form.name || !form.host}
        onClick={onSave}
      >
        Save proxy
      </button>
    </ModalDialog>
  );
}
