import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  routeProxy,
  type ProxyInput,
  type ProxyRoute,
} from "../../src/core/proxy/routing.js";

type FixtureCase = {
  name: string;
  input: ProxyInput;
  expected?: ProxyRoute;
  error?: string;
};

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/proxy-routing.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: FixtureCase[];
};

describe("proxy routing fixture", () => {
  it("matches all six parity rows exactly", () => {
    expect(fixture.cases).toHaveLength(6);
    for (const testCase of fixture.cases) {
      if (testCase.error) {
        expect(() => routeProxy(testCase.input), testCase.name).toThrow(
          testCase.error,
        );
      } else {
        expect(routeProxy(testCase.input), testCase.name).toEqual(
          testCase.expected,
        );
      }
    }
  });

  it.each([
    ["http", undefined, { server: "http://proxy.test:8080" }],
    [
      "http",
      "auth",
      { server: "http://proxy.test:8080", username: "u", password: "p" },
    ],
    ["https", undefined, { server: "https://proxy.test:443" }],
    [
      "https",
      "auth",
      { server: "https://proxy.test:443", username: "u", password: "p" },
    ],
  ])("returns a Playwright object for %s %s", (protocol, auth, expected) => {
    const input: ProxyInput = {
      protocol,
      host: "proxy.test",
      port: protocol === "https" ? 443 : 8080,
    };
    if (auth) Object.assign(input, { username: "u", password: "p" });
    expect(routeProxy(input)).toEqual({
      mode: "direct",
      launchProxy: expected,
    });
    expect(typeof routeProxy(input).launchProxy).toBe("object");
  });

  it("keeps unauthenticated SOCKS routes as direct strings", () => {
    expect(
      routeProxy({ protocol: "socks5", host: "proxy.test", port: 1080 })
        .launchProxy,
    ).toBe("socks5://proxy.test:1080");
    expect(
      routeProxy({ protocol: "socks4", host: "proxy.test", port: 1080 })
        .launchProxy,
    ).toBe("socks4://proxy.test:1080");
  });

  it("rejects invalid ports", () => {
    expect(() =>
      routeProxy({ protocol: "http", host: "proxy.test", port: 65536 }),
    ).toThrow("proxy port is invalid");
  });
});
