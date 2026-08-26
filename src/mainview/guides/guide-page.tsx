import type { PropsWithChildren, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { GUIDE_ROUTES } from "./routes.js";
import type { GuideSnippet, GuideTool } from "./types.js";

type GuidePageProps = PropsWithChildren<{
  readonly title: string;
  readonly description: string;
}>;

type GuideDisclosureProps = PropsWithChildren<{
  readonly section: { readonly name: string; readonly description: string };
}>;

export function GuidePage({ title, description, children }: GuidePageProps) {
  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="eyebrow">Guides</p>
      <h2 id="page-title" className="text-3xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-zinc-400">{description}</p>
      <nav aria-label="Guide navigation" className="mt-6 flex flex-wrap gap-2">
        {GUIDE_ROUTES.map((route) => (
          <NavLink
            key={route.path}
            to={route.path}
            className={({ isActive }) =>
              `table-action ${isActive ? "border-emerald-400 bg-emerald-950/35" : ""}`
            }
          >
            {route.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-8 grid gap-4">{children}</div>
    </section>
  );
}

export function GuideDisclosure({ section, children }: GuideDisclosureProps) {
  return (
    <details className="panel">
      <summary className="cursor-pointer select-none list-none">
        <span className="block font-medium">{section.name}</span>
        <span className="mt-1 block max-w-3xl text-sm text-zinc-400">
          {section.description}
        </span>
      </summary>
      <div className="mt-4 border-t border-zinc-800 pt-4">{children}</div>
    </details>
  );
}

export function GuideSnippet({ snippet }: { readonly snippet: GuideSnippet }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
        {snippet.label}
      </p>
      <pre className="code-block mt-2">
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}

export function GuideToolTable({
  tools,
}: {
  readonly tools: readonly GuideTool[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[44rem]">
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">What the AI can do</th>
            <th scope="col">Arguments</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.name}>
              <td>
                <code>{tool.name}</code>
              </td>
              <td>{tool.description}</td>
              <td>{tool.arguments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GuideSection({ children }: { readonly children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}
