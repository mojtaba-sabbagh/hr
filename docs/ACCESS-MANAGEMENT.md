# Accounts, groups, and subsystem permissions

The portal now has three account levels:

| Account level | Account-management authority |
| --- | --- |
| Superadmin | Enables subsystems, creates subsystem admins, assigns or revokes admin scopes, manages all groups and accounts, and disables accounts. |
| Subsystem admin | Creates regular users and groups in assigned **active** subsystems, edits those groups' permissions, and manages membership in those groups. |
| User | Receives operational permissions from group membership. Cannot administer accounts or groups. |

Business titles such as HR manager, HR supervisor, HSE officer, and environment supervisor are **group templates**, not account-management roles. An operational manager group never confers subsystem-admin authority.

## Using the screens

1. As superadmin, open **ادمین‌های زیرسیستم**, choose **ایجاد ادمین زیرسیستم**, and enter the name, email, initial password, and managed subsystems. Operational groups for the admin are optional.
2. Sign in as the subsystem admin and open **گروه‌ها و مجوزها**. Create a group, optionally start from a template, and select its permissions.
3. Open **کاربران** and create an account with one or more groups. To add a person who already has an account in another department, choose **افزودن حساب موجود با ایمیل**; this adds memberships without changing their credentials.
4. Use **گروه‌ها** in a user's row to replace memberships in your managed subsystems. An empty selection revokes those memberships. Other departments' memberships are preserved.
5. Use **ویرایش** on a group to change its permissions. All members receive the new permission set on their next server request. The user dashboard shows their groups and effective permissions and refreshes access when the browser regains focus.

The application does not email credentials. The creator supplies the initial password and hands the credentials to the account owner through their usual channel.

## Mockup sources and mapping

| Reference | Implemented permission/template mapping |
| --- | --- |
| `hr-portal-main.html`: `HR_MODULES`, `NAV_EMP`, `NAV_SUP`, `NAV_SUP_SELF` | HR personnel, recruitment, placement, performance, questionnaires, attendance, reports, personal data, team requests and evaluation. HR manager, supervisor and employee templates; personal and team scopes have distinct keys. |
| `hse-portal 1.7.html`: `U`, `PM`, `ROLE`, `canSee`, `vcap` | HSE manager, supervisor, officer, environment supervisor and worker templates. Safety and environment permissions are separate; permits, risk acceptance, incident closure, violations, calibration, personal reports and health questionnaires are represented. |
| `itfco-portal (4).html`: `P.ROLES`, `P.ACL`, `P.PAGE_LIMIT`, module navigation | Finance, warehouse, procurement, maintenance, development and support; read versus operational permissions; employee catalog/service access. Portal `p` maps to `core`, deputy reporting maps to `analytics`, and shift activities map to `shiftwise`. |

The mockups encode access mostly in JavaScript roles and view/action checks rather than a database permission table. `app/lib/access-catalog.ts` translates these into explicit permission keys and editable templates. Demo identities and passwords are not imported into the application database.

## Persistence and authorization

- Account management uses the existing `User`, `SubsystemAdminScope`, `Group`, `Permission`, `GroupPermission`, and `UserGroup` tables. The core portal adds a separate additive migration; see [CORE-PORTAL.md](CORE-PORTAL.md).
- Missing subsystem catalog rows are initialized idempotently when the superadmin loads the portal. Existing activation settings are preserved. Additional departments from the mockups start inactive.
- Every group belongs to one subsystem. Permission assignment accepts only known catalog keys for that subsystem. Unknown keys, wildcards, and cross-subsystem permissions are rejected.
- Regular users are created with groups, not direct subsystem or permission grants. Legacy `UserSubsystem` rows remain available to locate old accounts for migration but do not grant runtime permissions or subsystem access.
- Admin scope is resolved from `SubsystemAdminScope`, never from a business group or the union of a user's accessible subsystems.
- Session cookies identify the account; role, active status, scopes, memberships and permissions are read from PostgreSQL on every authenticated server request. Existing cookies cannot retain removed privileges. Disabled subsystems contribute neither permissions nor admin scopes.
- The user dashboard hides inactive and unassigned subsystems. Admin listings omit out-of-scope accounts and memberships. Password hashes are never returned by the management APIs.
- `requirePermission(session, key)` is the server guard for business endpoints. The core portal implements requests, notifications, ideas, announcements and the directory with additional record-level checks. Full HR/HSE/department business pages remain HTML mockups. Their future APIs must enforce permissions and record ownership/team boundaries. The mockup HTML files are references, not protected production applications.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/access` | Scoped accounts, groups, subsystems, permission catalog and templates. |
| `POST /api/admin/users` | Create a subsystem admin (superadmin only) or grouped regular user. |
| `PATCH /api/admin/users/:id` | Change admin subsystem scopes or account activation (superadmin only). |
| `PUT /api/admin/users/:id/groups` | Replace group memberships within the caller's scope. |
| `POST /api/admin/users/memberships` | Add an existing regular user to scoped groups by exact email. |
| `POST /api/admin/groups` | Create a scoped permission group. |
| `PATCH /api/admin/groups/:id` | Change group name and permission set; subsystem is immutable. |
| `GET /api/auth/session` | Current effective access for the signed-in account. |

## Verification

`npm run test:access` exercises the complete account/group authorization workflow against a disposable PostgreSQL schema. It requires the configured database user to be allowed to create and drop schemas. The test creates its own schema, migrates it, and removes it on completion; it never modifies the application's tables.

`node scripts/preview-access.cjs` starts a separate, temporary browser QA environment with its own database schema and copied source. It prints a localhost URL. Its synthetic superadmin is `root@access-test.invalid` with password `Access-preview-123`; these credentials apply only to the disposable preview. Send `stop` to its standard input to stop the server and remove the preview schema. No credentials or connection strings from the application are displayed.

`npm run build` validates production compilation and TypeScript checking.
