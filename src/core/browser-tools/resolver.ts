import { ProfileNotRunningError } from "./types";

export type RunningProfile = { relayCdpUrl: string };
export type RunningProfileLookup = (
  profileId: string,
) => Promise<RunningProfile | undefined>;

export class ProfileResolver {
  constructor(private readonly lookup: RunningProfileLookup) {}

  async resolve(profileId: string): Promise<RunningProfile> {
    const profile = await this.lookup(profileId);
    if (!profile?.relayCdpUrl) throw new ProfileNotRunningError();
    let url: URL;
    try {
      url = new URL(profile.relayCdpUrl);
    } catch {
      throw new ProfileNotRunningError();
    }
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ProfileNotRunningError();
    return profile;
  }
}
