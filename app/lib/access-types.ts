import type { GroupTemplate, PermissionDefinition } from "./access-catalog";
import type { Role } from "./session-types";
export type ManagedSubsystem = { key: string; title: string; enabled: boolean };
export type ManagedGroup = { id: string; name: string; subsystemKey: string; permissionKeys: string[]; memberCount: number };
export type ManagedUser = { id: string; name: string; email: string; role: Role; active: boolean; adminSubsystemKeys: string[]; groupIds: string[] };
export type AccessData = {
  subsystems: ManagedSubsystem[];
  groups: ManagedGroup[];
  users: ManagedUser[];
  permissions: PermissionDefinition[];
  templates: GroupTemplate[];
};
