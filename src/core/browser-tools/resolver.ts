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
    return profile;
  }
}
