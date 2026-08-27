import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "BrowserLogin",
    identifier: "co.browserlogin.app",
    version: "0.1.21",
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
      icons: "resources/icons/browserlogin.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "resources/icons/browserlogin.png",
    },
    win: {
      bundleCEF: false,
      icon: "resources/icons/browserlogin.ico",
    },
  },
  scripts: {
    postWrap: "./scripts/post-wrap.ts",
  },
  release: {
    baseUrl:
      "https://github.com/iamkhalidbashir/browserlogin-client/releases/download/stable",
    generatePatch: true,
  },
} satisfies ElectrobunConfig;
