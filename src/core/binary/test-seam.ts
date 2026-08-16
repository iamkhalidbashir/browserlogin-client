let testOfficialSigningPublicKey: string | undefined;

export function setTestOfficialSigningPublicKey(key: string | undefined): void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("test signing seam is unavailable outside test mode");
  testOfficialSigningPublicKey = key;
}

export function getTestOfficialSigningPublicKey(): string | undefined {
  return process.env.NODE_ENV === "test"
    ? testOfficialSigningPublicKey
    : undefined;
}
