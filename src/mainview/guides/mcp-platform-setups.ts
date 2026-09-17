import type { McpPlatformSetup } from "./types.js";

export const MCP_PLATFORM_SETUPS = [
  {
    id: "macos",
    name: "macOS",
    description: "Apple Silicon",
    steps: [
      "Download BrowserLogin-<version>-macos-arm64.dmg from GitHub Releases.",
      "Open the disk image and move BrowserLogin to Applications.",
    ],
    snippet: null,
  },
  {
    id: "windows",
    name: "Windows",
    description: "Windows x64",
    steps: [
      "Download and extract BrowserLogin-<version>-windows-x64-Setup.zip.",
      "Keep the .installer directory beside the installer, then run Install-BrowserLogin.cmd.",
    ],
    snippet: null,
  },
  {
    id: "linux",
    name: "Linux",
    description: "Ubuntu 24.04+ x64",
    steps: [
      "Install the GTK, WebKit, and app-indicator runtime packages below.",
      "Run the Setup.tar.gz installer or the AppImage. AppImage may require FUSE 2 compatibility.",
    ],
    snippet: {
      label: "Runtime dependencies",
      language: "shell",
      code: `sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1`,
    },
  },
] as const satisfies readonly McpPlatformSetup[];
