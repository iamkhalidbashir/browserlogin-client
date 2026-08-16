import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { createReadStream } from "node:fs";
import {
  BinaryManagerError,
  type BinaryFetch,
  type BinaryPlatform,
  type BinarySource,
} from "./types.js";
import { archiveName } from "./versions.js";
import { getTestOfficialSigningPublicKey } from "./test-seam.js";

export const OFFICIAL_SIGNING_PUBLIC_KEY =
  "MKFKwIhUcKWq5xTuNA0Ovg99njcDEcEJvmWYYhApvaU=";

export type ManifestVerification = {
  sha256: string;
  trust: "verified" | "unverified-custom";
  manifest: string;
};

export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) result.set(match[2].trim(), match[1].toLowerCase());
  }
  return result;
}

export function parseManifestVersion(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("version="))
    ?.slice(8)
    .trim();
}

function verifyEd25519(
  manifest: Uint8Array,
  signatureText: string,
  publicKeyText = OFFICIAL_SIGNING_PUBLIC_KEY,
): boolean {
  const signature = Buffer.from(signatureText.trim(), "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64") !== signatureText.trim()
  )
    return false;
  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(publicKeyText, "base64").toString("base64url"),
    },
    format: "jwk",
  });
  return verifySignature(null, manifest, key, signature);
}

async function getText(
  fetchImpl: BinaryFetch,
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  const response = await fetchImpl(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function verifyArchive(
  archivePath: string,
  platform: BinaryPlatform,
  version: string,
  source: BinarySource,
  manifestBase: string,
  headers?: Record<string, string>,
  fetchImpl: BinaryFetch = fetch,
): Promise<ManifestVerification> {
  let manifest: string;
  let signature: string | undefined;
  try {
    manifest = await getText(
      fetchImpl,
      `${manifestBase.replace(/\/$/, "")}/SHA256SUMS`,
      headers,
    );
    try {
      signature = await getText(
        fetchImpl,
        `${manifestBase.replace(/\/$/, "")}/SHA256SUMS.sig`,
        headers,
      );
    } catch {
      signature = undefined;
    }
  } catch (error) {
    throw new BinaryManagerError(
      "CloakBrowser SHA256SUMS could not be fetched",
      "VERIFICATION_FAILED",
      { cause: error },
    );
  }
  if (source === "official") {
    if (
      !signature ||
      !verifyEd25519(
        new TextEncoder().encode(manifest),
        signature,
        getTestOfficialSigningPublicKey() ?? OFFICIAL_SIGNING_PUBLIC_KEY,
      )
    ) {
      throw new BinaryManagerError(
        "CloakBrowser SHA256SUMS signature verification failed",
        "VERIFICATION_FAILED",
      );
    }
    if (parseManifestVersion(manifest) !== version) {
      throw new BinaryManagerError(
        "Signed CloakBrowser manifest version binding failed",
        "VERIFICATION_FAILED",
      );
    }
  }
  const expected = parseChecksums(manifest).get(archiveName(platform));
  if (!expected)
    throw new BinaryManagerError(
      "CloakBrowser SHA256SUMS has no platform archive entry",
      "VERIFICATION_FAILED",
    );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected)
    throw new BinaryManagerError(
      "CloakBrowser archive SHA-256 verification failed",
      "VERIFICATION_FAILED",
    );
  return {
    sha256: actual,
    trust: source === "official" ? "verified" : "unverified-custom",
    manifest,
  };
}
