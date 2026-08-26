export default {
  electrobun: {
    version: "2.0.1",
  },
  packageManager: "bun",
  scripts: {
    install: ["bun", "install", "--frozen-lockfile"],
    build: ["bun", "scripts/electrobun.ts", "build", "--env=stable"],
  },
};
