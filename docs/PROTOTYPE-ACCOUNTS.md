# Prototype users and access

The import uses the final runtime data in `materials/itfco-portal(5).html`, including its generated employee roster, ninth supervisor, and later access patches. The HSE prototype contains the same identities; its reduced navigation is a standalone HSE view, not a second set of accounts.

The source contains **60 login identities**: nine management/HSE accounts, nine supervisors, and 42 employees. It defines ten business roles. `SYS` is an automated actor and the separately listed operational staff are explicitly marked as having no login accounts, so neither is converted into a login.

## Where to manage them

Sign in with the existing environment superadmin, open `/admin`, and choose **شرکت هوشمند فناوران برتر ایرانیان** (`itfco`). Use **کاربران شرکت** and **نقش‌ها و دسترسی‌ها** to inspect memberships, managers, and company permissions. In the main portal, **کاربران** and **گروه‌ها و مجوزها** show their subsystem permissions. The imported subsystem groups are named `نمونه پرتال · <business role>`.

Business roles remain ordinary `USER` accounts. Being an HR manager, finance manager, or deputy does not grant system account administration, form design, or workflow publication. The existing superadmin retains those capabilities.

| Prototype role | Company request access | Portal access |
| --- | --- | --- |
| معاون توسعه و پشتیبانی | All company requests, audit, company parameters | Operational permissions across prototype departments; matches the prototype's final deputy `rw` patch |
| مدیر مالی | Finance requests and reporting tree | Finance operations and personal/team services |
| مدیر انبار و لجستیک | Warehouse requests and reporting tree | Warehouse operations and personal/team services |
| مدیر سفارشات و تدارکات | Procurement requests and reporting tree | Procurement operations and personal/team services |
| مدیر تعمیرات و نگهداری | Maintenance requests and reporting tree | Maintenance operations and personal/team services |
| مدیر توسعه و پشتیبانی | Support/project requests and reporting tree | Support/project operations and personal/team services |
| مدیر منابع انسانی | HR requests and reporting tree | HR operations and personal/team services |
| مدیر HSE | HSE requests and reporting tree | HSE operations and personal/team services; both source HSE users have this role |
| سرپرست | Reporting tree | Direct-team HR/shift services, warehouse catalog/stock, equipment viewing, support ticket viewing |
| پرسنل | Own and assigned requests | Personal HR/shift/safety services, portal requests, catalog and service requests |

Company request visibility is enforced by the API for lists, detail URLs, and dashboard counts. A department filter cannot widen access. Viewing a department's requests does not allow approving or reassigning work: approval still requires an assigned task, and reassignment still requires workflow administration and company-wide viewing.

## Login addresses and initial passwords

The 18 named management/supervisor accounts keep the exact `@itfco.ir` addresses from the prototype. Its 42 employees have no email addresses; they receive deterministic login-only addresses such as `emp-1000@prototype.itfco.example`. These addresses are identifiers, not working mailboxes.

Each newly created account receives an independent random initial password. The import writes the roster and initial passwords to timestamped CSV files in the git-ignored `tmp/prototype-access/` folder. It never prints passwords in the console, writes them into source files, or changes an existing account's password. Keep the initial-password file with the administrator; it contains login credentials. An account's current password is authoritative after any subsequent password change.

## Repeating the import

```powershell
npm run seed:prototype -- --enable-modules
```

The command loads the same `.env.local`/`.env` configuration as the app and uses one database transaction. On the first import, `--enable-modules` activates the prototype's subsystem catalog and dependencies so assigned permissions are usable. Subsequent imports preserve module activation choices, passwords, account names/status, role/group edits, existing memberships, reporting changes, and existing HR data. No payroll, request, health, or performance history is seeded by this command.

`prisma/prototype-access.json` is the reviewed source snapshot. `app/lib/prototype-policy.ts` maps source roles to implemented permissions. The CLI checks the prototype's file hash before importing. To regenerate the snapshot after updating the prototype, run `node scripts/extract-prototype-access.cjs` with Playwright available through `PLAYWRIGHT_MODULE` and Edge installed. Contract dates in the prototype are generated relative to its clock and are frozen in this snapshot.

The import creates 51 linked HR profiles for the employees and supervisors with source contract dates. Their personnel codes are prefixed with `ITFCO-` to avoid replacing older sample records with overlapping `EMP-*` codes. The nine management accounts have no contract start dates in the source and receive no invented HR employment records; HR can complete those profiles later. Company reporting relationships are copied from the prototype even where a manager has no HR profile yet.

Existing starter templates reuse the imported department role names when installed. The generic **مدیر واحد** step still requires the administrator to configure the appropriate manager assignment before publication. This access import does not install or publish workflows, and permissions for unimplemented specialist modules do not implement those modules.

## Verification

`npm run test:prototype` uses a disposable PostgreSQL schema to verify the complete roster, real authentication, permission mapping, department isolation, reporting-tree access, template assignment, and preservation of administrator changes on repeated imports. Existing access/workflow regression suites also apply.
