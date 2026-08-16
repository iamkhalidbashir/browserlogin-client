import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import type { ServerResponse } from "node:http";
import { startServer, sendJson } from "./http.js";

export const TEST_ONLY_SIGNING_LABEL = "TEST-ONLY Ed25519 distribution key; never use in production";
const keyPair = generateKeyPairSync("ed25519");
export const testOnlyPublicKey = keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const archives = { "darwin-arm64": Buffer.from("CBP-DARWIN-TEST"), "linux-x64": Buffer.from("CBP-LINUX-TEST"), "windows-x64": Buffer.from("CBP-WINDOWS-TEST") } as const;
const sums = Object.entries(archives).map(([platform, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  cloakbrowser-${platform}.zip`).join("\n") + "\n";
const signature = sign(null, Buffer.from(sums), keyPair.privateKey);

export function verifyTestOnlyChecksums(bytes: Buffer, platform: keyof typeof archives, tamper = false): boolean {
  const expected = createHash("sha256").update(tamper ? Buffer.concat([bytes, Buffer.from("tamper")]) : bytes).digest("hex");
  const line = sums.split("\n").find(item => item.endsWith(`cloakbrowser-${platform}.zip`));
  return line?.startsWith(expected) === true && verify(null, Buffer.from(sums), keyPair.publicKey, signature);
}

export async function startDistributionMock() {
  return startServer(async ({ request }, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/SHA256SUMS") return sendJson(response, 200, { checksums: sums, signature: signature.toString("base64"), publicKey: testOnlyPublicKey, label: TEST_ONLY_SIGNING_LABEL });
    const match = url.pathname.match(/^\/archives\/([^/]+)\.zip$/);
    if (match && match[1] in archives) {
      const platform = match[1] as keyof typeof archives;
      const bytes = archives[platform];
      response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": bytes.length, "X-Test-Signing-Key": TEST_ONLY_SIGNING_LABEL });
      return response.end(bytes);
    }
    if (url.pathname === "/pro/browser-archive" && request.headers.authorization === "Bearer bl_test_key_secret") return sendJson(response, 200, { authenticated: true, archive: "TEST-ONLY" });
    sendJson(response, 404, { error: "not found" });
  });
}
