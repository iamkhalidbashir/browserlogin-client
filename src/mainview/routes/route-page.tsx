export function RoutePage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section aria-labelledby="page-title">
      <p className="eyebrow">Workspace</p>
      <h2 id="page-title" className="text-3xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-zinc-400">{description}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="metric-card">
          <span>Local sessions</span>
          <strong>0</strong>
        </article>
        <article className="metric-card">
          <span>Profiles ready</span>
          <strong>1</strong>
        </article>
        <article className="metric-card">
          <span>Archive health</span>
          <strong>Good</strong>
        </article>
      </div>
      <div className="panel mt-6">
        <h3 className="font-medium">Ready for configuration</h3>
        <p className="mt-2 text-sm text-zinc-400">
          This route is connected to the typed BrowserLogin RPC bridge and mock
          data layer.
        </p>
      </div>
    </section>
  );
}
