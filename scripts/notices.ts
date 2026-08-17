import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format } from "prettier";

const root = process.cwd();
const packagePath = join(root, "package.json");
const outputPath = join(root, "NOTICES.md");

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type InstalledManifest = {
  name?: string;
  version?: string;
  license?: string | { type?: string } | Array<{ type?: string }>;
  homepage?: string;
  repository?: string | { url?: string };
};

type Notice = {
  scope: "Runtime" | "Development";
  name: string;
  declared: string;
  installed: string;
  license: string;
  source: string;
};

function licenseName(value: InstalledManifest["license"]): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const names = value
      .map((item) => item.type?.trim())
      .filter((item): item is string => Boolean(item));
    if (names.length) return names.join(" OR ");
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.type?.trim()
  )
    return value.type.trim();
  throw new Error("installed package has no declared license");
}

function sourceUrl(manifest: InstalledManifest): string {
  if (manifest.homepage?.trim()) return manifest.homepage.trim();
  const repository = manifest.repository;
  const value =
    typeof repository === "string" ? repository : (repository?.url ?? "");
  return value
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

function markdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function noticesFor(
  scope: Notice["scope"],
  dependencies: Record<string, string>,
): Promise<Notice[]> {
  const notices: Notice[] = [];
  for (const [name, declared] of Object.entries(dependencies).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const installedPath = join(root, "node_modules", name, "package.json");
    let installed: InstalledManifest;
    try {
      installed = JSON.parse(
        await readFile(installedPath, "utf8"),
      ) as InstalledManifest;
    } catch (error) {
      throw new Error(`missing installed metadata for ${name}`, {
        cause: error,
      });
    }
    if (installed.name !== name)
      throw new Error(`installed package name mismatch for ${name}`);
    if (!installed.version)
      throw new Error(`installed package has no version: ${name}`);
    notices.push({
      scope,
      name,
      declared,
      installed: installed.version,
      license: licenseName(installed.license),
      source: sourceUrl(installed),
    });
  }
  return notices;
}

function render(notices: Notice[]): string {
  const runtime = notices.filter((notice) => notice.scope === "Runtime");
  const development = notices.filter(
    (notice) => notice.scope === "Development",
  );
  const table = (items: Notice[]) =>
    [
      "| Package | Declared range | Installed | License | Source |",
      "| --- | --- | --- | --- | --- |",
      ...items.map(
        (notice) =>
          `| ${markdown(notice.name)} | ${markdown(notice.declared)} | ${markdown(notice.installed)} | ${markdown(notice.license)} | ${notice.source ? `[link](${notice.source})` : "Not declared"} |`,
      ),
    ].join("\n");
  return `# Third-party notices

This file is generated from the direct dependencies declared in \`package.json\`
and the installed package metadata in \`node_modules\`. Run
\`bun scripts/notices.ts\` after dependency updates and
\`bun scripts/notices.ts --check\` in verification workflows.

The table records package metadata; the authoritative license terms remain in
each dependency's distributed license file and source repository.

## Runtime dependencies (${runtime.length})

${table(runtime)}

## Development dependencies (${development.length})

${table(development)}

## Coverage

- Runtime direct dependencies: ${runtime.length}/${runtime.length}
- Development direct dependencies: ${development.length}/${development.length}
- Total direct dependencies: ${notices.length}/${notices.length}
`;
}

const project = JSON.parse(
  await readFile(packagePath, "utf8"),
) as PackageManifest;
const notices = [
  ...(await noticesFor("Runtime", project.dependencies ?? {})),
  ...(await noticesFor("Development", project.devDependencies ?? {})),
];
const expectedCount =
  Object.keys(project.dependencies ?? {}).length +
  Object.keys(project.devDependencies ?? {}).length;
if (notices.length !== expectedCount)
  throw new Error(
    `notice coverage mismatch: ${notices.length}/${expectedCount}`,
  );
const output = await format(render(notices), { parser: "markdown" });

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing.replaceAll("\r\n", "\n") !== output) {
    process.stderr.write(
      "NOTICES.md is out of date; run bun scripts/notices.ts\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `NOTICES.md covers ${notices.length} direct dependencies\n`,
    );
  }
} else {
  await writeFile(outputPath, output);
  process.stdout.write(
    `wrote NOTICES.md for ${notices.length} direct dependencies\n`,
  );
}
