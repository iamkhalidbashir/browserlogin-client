import { join } from "node:path";
import { lockName } from "./locks.js";

export const LOCK_NAMES = {
  connectionTransition: "connection-transition",
  profile: (profileId: string) => `profile-${lockName(profileId)}`,
  binaryVersion: (version: string) => `binary-version-${lockName(version)}`,
} as const;

export const lockPath = (directory: string, name: string): string =>
  join(directory, `${name}.lock`);
export const connectionTransitionLock = (directory: string) =>
  lockPath(directory, LOCK_NAMES.connectionTransition);
export const profileLock = (directory: string, profileId: string) =>
  lockPath(directory, LOCK_NAMES.profile(profileId));
export const binaryVersionLock = (directory: string, version: string) =>
  lockPath(directory, LOCK_NAMES.binaryVersion(version));
