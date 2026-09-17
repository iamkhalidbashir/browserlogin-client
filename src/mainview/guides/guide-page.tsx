import { useState } from "react";
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

type CopyState = "idle" | "copied" | "failed";

const COPY_LABELS = {
  idle: "Copy",
  copied: "Copied",
  failed: "Retry",
} as const satisfies Record<CopyState, string>;

const COPY_ANNOUNCEMENTS = {
  idle: "",
  copied: "Copied to clipboard.",
  failed: "Copy failed. Try again.",
} as const satisfies Record<CopyState, string>;

export function GuidePage({ title, description, children }: GuidePageProps) {
  return (
    <section aria-labelledby="page-title" className="max-w-5xl">
      <p className="eyebrow">Guides</p>
      <h2 id="page-title" className="text-3xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="guide-muted mt-2 max-w-3xl">{description}</p>
      {GUIDE_ROUTES.length > 1 ? (
        <nav
          aria-label="Guide navigation"
          className="mt-6 flex flex-wrap gap-2"
        >
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
      ) : null}
      <div className="mt-8 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {children}
      </div>
    </section>
  );
}

export function GuideDisclosure({ section, children }: GuideDisclosureProps) {
  return (
    <details className="group panel overflow-hidden">
      <summary className="flex cursor-pointer list-none select-none items-start justify-between gap-4 rounded-md">
        <span className="min-w-0">
          <span className="block font-medium">{section.name}</span>
          <span className="guide-muted mt-1 block max-w-3xl text-sm">
            {section.description}
          </span>
        </span>
        <span className="guide-disclosure-action flex shrink-0 items-center gap-2 pt-0.5 text-xs font-semibold">
          <span className="group-open:hidden">Show details</span>
          <span className="hidden group-open:inline">Hide details</span>
          <svg
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            fill="none"
            viewBox="0 0 20 20"
          >
            <path
              d="m7.5 5 5 5-5 5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
        </span>
      </summary>
      <div className="guide-divider mt-4 border-t pt-4">{children}</div>
    </details>
  );
}

export function GuideSnippet({ snippet }: { readonly snippet: GuideSnippet }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="guide-muted text-xs font-semibold uppercase tracking-[0.12em]">
        {snippet.label}
      </p>
      <pre className="code-block mt-2">
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}

export function GuideCopyField({
  label,
  value,
  prominent = false,
  wrap = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly prominent?: boolean;
  readonly wrap?: boolean;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const displayUrl = wrap ? new URL(value) : null;

  const copyValue = () => {
    void navigator.clipboard.writeText(value).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };

  return (
    <div
      aria-label={label}
      className={`guide-copy-field ${prominent ? "guide-copy-field-prominent" : ""} ${wrap ? "guide-copy-field-wrap" : ""}`}
      role="group"
    >
      <code
        className={`min-w-0 flex-1 ${wrap ? "guide-copy-value-wrap" : "overflow-x-auto whitespace-nowrap"} ${prominent ? "text-base font-semibold sm:text-lg" : "text-sm sm:text-base"}`}
      >
        {displayUrl ? (
          <>
            <span>{displayUrl.protocol}//</span>
            <wbr />
            {displayUrl.hostname.split(/([.-])/).map((segment, index) => (
              <span key={`${index}-${segment}`}>
                {segment}
                {segment === "." || segment === "-" ? <wbr /> : null}
              </span>
            ))}
            <wbr />
            <span>
              {displayUrl.pathname}
              {displayUrl.search}
              {displayUrl.hash}
            </span>
          </>
        ) : (
          value
        )}
      </code>
      <button
        aria-label={`Copy ${label}`}
        className="table-action flex shrink-0 items-center gap-2"
        onClick={copyValue}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          viewBox="0 0 20 20"
        >
          <rect
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            width="9"
            x="7"
            y="7"
          />
          <path
            d="M5.5 13H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
        <span>{COPY_LABELS[copyState]}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {COPY_ANNOUNCEMENTS[copyState]}
      </span>
    </div>
  );
}

export function GuideSteps({ steps }: { readonly steps: readonly string[] }) {
  return (
    <ol className="guide-body grid list-decimal gap-2 pl-5 text-sm leading-6">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function GuideToolTable({
  tools,
}: {
  readonly tools: readonly GuideTool[];
}) {
  return (
    <div
      aria-label="AI tool table"
      className="overflow-x-auto"
      role="region"
      tabIndex={0}
    >
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
