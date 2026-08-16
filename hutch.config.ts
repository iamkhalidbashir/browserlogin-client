// @hutch cli=0.10.0 cottontail=0.4.4
export default {
  electrobun: {
    version: "2.0.1-beta.14",
  },
  packageManager: "bun",
  scripts: {
    install: ["bun", "install", "--frozen-lockfile"],
    build: ["hutch", "electrobun", "build", "--env=production"],
  },
};
