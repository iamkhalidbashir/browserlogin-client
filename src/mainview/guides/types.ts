export type GuideSnippet = {
  readonly label: string;
  readonly language: "json" | "shell" | "toml";
  readonly code: string;
};

export type McpClientId =
  | "chatgpt-desktop"
  | "cursor"
  | "vscode"
  | "claude-code"
  | "codex-cli"
  | "opencode";

export type McpClientConfig = {
  readonly id: McpClientId;
  readonly name: string;
  readonly description: string;
  readonly transport: "streamable-http";
  readonly steps: readonly string[];
  readonly snippets: readonly GuideSnippet[];
};

export type McpPlatformSetup = {
  readonly id: "macos" | "windows" | "linux";
  readonly name: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly snippet: GuideSnippet | null;
};

export type GuideTool = {
  readonly name: string;
  readonly description: string;
  readonly arguments: string;
};

export type GuideToolGroup = {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly GuideTool[];
};
