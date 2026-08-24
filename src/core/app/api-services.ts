import type { BrowserLoginClient } from "../api/client.js";
import type { Profile, Proxy } from "../../shared/api-types.js";
import { AppRPCSchemas } from "../../shared/rpc-schema.js";
import type { ApplicationServices } from "./contracts.js";

function stripProxySecret(proxy: Proxy | null): Omit<Proxy, "password"> | null {
  if (!proxy) return null;
  const { password, ...safe } = proxy;
  void password;
  return safe;
}

function stripProfileSecrets(profile: Profile): Omit<Profile, "proxy"> & {
  readonly proxy: Omit<Proxy, "password"> | null;
} {
  return { ...profile, proxy: stripProxySecret(profile.proxy) };
}

export function createApiServices(
  resolveClient: () => Promise<BrowserLoginClient>,
): ApplicationServices {
  return {
    profilesList: async () =>
      (await (await resolveClient()).listProfiles()).map(stripProfileSecrets),
    profilesGet: async (raw) => {
      const input = AppRPCSchemas.profilesGet.params.parse(raw);
      return stripProfileSecrets(
        await (await resolveClient()).getProfile(input.profileId),
      );
    },
    profilesCreate: async (raw) => {
      const input = AppRPCSchemas.profilesCreate.params.parse(raw);
      return stripProfileSecrets(
        await (await resolveClient()).createProfile(input),
      );
    },
    profilesUpdate: async (raw) => {
      const { profileId, expectedConfigVersion, ...fields } =
        AppRPCSchemas.profilesUpdate.params.parse(raw);
      return stripProfileSecrets(
        await (
          await resolveClient()
        ).updateProfile(profileId, {
          ...fields,
          expected_config_version: expectedConfigVersion,
        }),
      );
    },
    profilesDelete: async (raw) => {
      const input = AppRPCSchemas.profilesDelete.params.parse(raw);
      return (await resolveClient()).deleteProfile(input.profileId);
    },
    profilesRestore: async (raw) => {
      const input = AppRPCSchemas.profilesRestore.params.parse(raw);
      return (await resolveClient()).restoreProfile(input.profileId);
    },
    proxiesList: async () =>
      (await (await resolveClient()).listProxies()).map(stripProxySecret),
    proxiesCreate: async (raw) => {
      const input = AppRPCSchemas.proxiesCreate.params.parse(raw);
      return stripProxySecret(await (await resolveClient()).createProxy(input));
    },
    proxiesUpdate: async (raw) => {
      const { proxyId, ...input } =
        AppRPCSchemas.proxiesUpdate.params.parse(raw);
      return stripProxySecret(
        await (await resolveClient()).updateProxy(proxyId, input),
      );
    },
    proxiesDelete: async (raw) => {
      const input = AppRPCSchemas.proxiesDelete.params.parse(raw);
      return (await resolveClient()).deleteProxy(input.proxyId);
    },
    proxiesChangeIp: async (raw) => {
      const input = AppRPCSchemas.proxiesChangeIp.params.parse(raw);
      return (await resolveClient()).changeProxyIp(input.proxyId);
    },
    usersList: async () => (await resolveClient()).listUsers(),
    usersDisable: async (raw) => {
      const input = AppRPCSchemas.usersDisable.params.parse(raw);
      return (await resolveClient()).disableUser(input.userId);
    },
    membersList: async (raw) => {
      const input = AppRPCSchemas.membersList.params.parse(raw);
      return (await resolveClient()).listMembers(input.profileId);
    },
    membersShare: async (raw) => {
      const input = AppRPCSchemas.membersShare.params.parse(raw);
      return (await resolveClient()).shareProfile(
        input.profileId,
        input.userId,
        input.role,
      );
    },
    membersRemove: async (raw) => {
      const input = AppRPCSchemas.membersRemove.params.parse(raw);
      return (await resolveClient()).removeMember(
        input.profileId,
        input.userId,
      );
    },
    notesGet: async (raw) => {
      const input = AppRPCSchemas.notesGet.params.parse(raw);
      return (await resolveClient()).getNotes(input.profileId);
    },
    notesAppend: async (raw) => {
      const input = AppRPCSchemas.notesAppend.params.parse(raw);
      return (await resolveClient()).appendNotes(
        input.profileId,
        input.notes,
        input.expectedVersion,
      );
    },
    notesReplace: async (raw) => {
      const input = AppRPCSchemas.notesReplace.params.parse(raw);
      return (await resolveClient()).replaceNotes(
        input.profileId,
        input.notes,
        input.expectedVersion,
      );
    },
    notesHistory: async (raw) => {
      const input = AppRPCSchemas.notesHistory.params.parse(raw);
      return (await resolveClient()).listNoteHistory(input.profileId);
    },
    auditList: async (raw) => {
      const input = AppRPCSchemas.auditList.params.parse(raw);
      return (await resolveClient()).listAudit(input.profileId);
    },
  };
}
