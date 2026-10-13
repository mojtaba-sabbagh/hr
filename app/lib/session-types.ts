export type Role = "SUPER_ADMIN" | "SUBSYSTEM_ADMIN" | "USER";
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  subsystemKeys: string[];
  adminSubsystemKeys: string[];
  permissions: string[];
  groups: { id: string; name: string; subsystemKey: string }[];
};
