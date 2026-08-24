import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "BrowserLogin",
    identifier: "co.browserlogin.app",
    version: "0.1.10",
  },
  build: {
    mainProcess: "bun",
    artifactFolder: "artifacts",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/mainview": "views/mainview",
      "dist/vendor": "vendor",
      "dist/runner": "runner",
    },
    mac: {
      codesign: true,
      notarize: true,
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
  release: {
    baseUrl:
      "https://github.com/iamkhalidbashir/browserlogin-client/releases/download/stable",
    generatePatch: true,
  },
} satisfies ElectrobunConfig;
