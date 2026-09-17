import { lazy, Suspense } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useBridge } from "./rpc-client.js";
import SetupView from "./features/setup/setup-view.js";
import { StatusRefresh } from "./features/status/status-refresh.js";
import { GUIDE_ROUTES } from "./guides/routes.js";
import logoUrl from "../../resources/icons/browserlogin.png";

const Dashboard = lazy(() => import("./features/profiles/profiles-view.js"));
const Proxies = lazy(() => import("./routes/proxies.js"));
const Users = lazy(() => import("./routes/users.js"));
const Audit = lazy(() => import("./routes/audit.js"));
const Settings = lazy(() => import("./routes/settings.js"));
const McpGuide = lazy(() => import("./routes/guide-mcp.js"));

const routes = [
  ["/dashboard", "Dashboard"],
  ["/proxies", "Proxies"],
  ["/users", "Users"],
  ["/audit", "Audit"],
  ["/settings", "Settings"],
  ...GUIDE_ROUTES.map((route) => [route.path, route.label] as const),
] as const;

function LegacyRouteRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{
        pathname: "/dashboard",
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  );
}

export function App() {
  const bridge = useBridge();
  const connection = useQuery({
    queryKey: ["connection"],
    queryFn: async () => {
      const result = await bridge.request("connectionGet", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const binary = useQuery({
    queryKey: ["binary"],
    enabled: connection.data?.hasApiKey === true,
    queryFn: async () => {
      const result = await bridge.request("binaryStatus", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  if (connection.isPending)
    return (
      <SetupView
        key="connection"
        step="connection"
        status={{ state: "pending" }}
        onRetryStatus={() => void connection.refetch()}
      />
    );
  if (connection.isError)
    return (
      <SetupView
        key="connection"
        step="connection"
        status={{ state: "error", message: connection.error.message }}
        onRetryStatus={() => void connection.refetch()}
      />
    );
  if (!connection.data.hasApiKey)
    return (
      <SetupView
        key="connection"
        step="connection"
        status={{ state: "required" }}
        onRetryStatus={() => void connection.refetch()}
      />
    );
  if (binary.isPending)
    return (
      <SetupView
        key="runtime"
        step="runtime"
        status={{ state: "pending" }}
        hasLicense={connection.data.hasLicense}
        onRetryStatus={() => void binary.refetch()}
      />
    );
  if (binary.isError)
    return (
      <SetupView
        key="runtime"
        step="runtime"
        status={{ state: "error", message: binary.error.message }}
        hasLicense={connection.data.hasLicense}
        onRetryStatus={() => void binary.refetch()}
      />
    );
  if (binary.data === null)
    return (
      <SetupView
        key="runtime"
        step="runtime"
        status={{ state: "required" }}
        hasLicense={connection.data.hasLicense}
        onRetryStatus={() => void binary.refetch()}
      />
    );
  return (
    <div className="app-shell min-h-[100dvh] bg-zinc-50 text-zinc-950">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="grid min-h-[100dvh] grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside
          className="app-sidebar border-b border-zinc-200 bg-white/80 p-4 md:border-b-0 md:border-r md:p-5"
          aria-label="Primary navigation"
        >
          <div className="mb-4 flex items-start gap-3 md:mb-8">
            <img
              src={logoUrl}
              alt="BrowserLogin logo"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-lg"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
                BrowserLogin
              </p>
              <h1 className="mt-2 text-xl font-semibold">Control center</h1>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 md:block md:space-y-1">
            {routes.map(([path, label]) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "nav-link-active" : ""}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="app-header flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 md:px-7">
            <div
              className="flex flex-wrap gap-2"
              aria-label="Application status"
            >
              <span className="status-pill">
                {connection.isLoading
                  ? "Connecting"
                  : connection.data?.hasApiKey
                    ? "Connected"
                    : "Setup required"}
              </span>
              <span className="status-pill">Free</span>
            </div>
            <StatusRefresh />
          </header>
          <main id="main" className="p-4 md:p-7" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="skeleton h-40" aria-label="Loading route" />
              }
            >
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/profiles" element={<LegacyRouteRedirect />} />
                <Route path="/proxies" element={<Proxies />} />
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/sessions" element={<LegacyRouteRedirect />} />
                <Route path="/settings" element={<Settings />} />
                <Route
                  path="/guides"
                  element={<Navigate to="/guides/mcp" replace />}
                />
                <Route path="/guides/mcp" element={<McpGuide />} />
                <Route
                  path="*"
                  element={<Navigate to="/dashboard" replace />}
                />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
