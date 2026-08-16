import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "BrowserLogin",
    identifier: "co.browserlogin.app",
    version: "0.1.0",
  },
  build: {
    mainProcess: "cottontail",
    artifactFolder: "artifacts",
    cottontail: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
    },
    mac: {
      codesign: false,
      notarize: false,
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
