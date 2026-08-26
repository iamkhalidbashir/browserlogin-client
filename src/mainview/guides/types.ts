export type GuideSnippet = {
  readonly label: string;
  readonly language: "json" | "shell" | "toml";
  readonly code: string;
};

export type McpClientConfig = {
  readonly name: string;
  readonly description: string;
  readonly snippets: readonly GuideSnippet[];
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

export type CliGuideCommand = {
  readonly command: string;
  readonly description: string;
};
