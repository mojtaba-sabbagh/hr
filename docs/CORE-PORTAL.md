# Core portal

The working core subsystem is at `/core`. Its Persian, right-to-left interface uses the logo, green/sage colors and Vazirmatn typography from `itfco-portal (4).html`. The same shell and theme cover the main portal, access management and login. Brand images were extracted unchanged into `public/brand`; fonts are served locally. Vazirmatn is distributed under the included SIL Open Font License.

## Enable access

1. As superadmin, enable **هسته پرتال و دسترسی** in subsystem management.
2. Assign a subsystem admin to `core` if someone else will manage its accounts and groups.
3. Create a group using the **کاربر پرتال** template for personal services, or the core manager template for all core permissions. Select individual permissions when a narrower reviewer/publisher group is needed.
4. Join users to the appropriate group(s). A subsystem administrator can manage accounts in their scope, but operational permissions still come from group membership.
5. Open **ورود به هسته پرتال** from the main portal or sidebar. Disabled and unassigned subsystems remain hidden from the user panel. Direct core URLs and APIs also enforce access on the server.

Existing groups are not automatically granted newly introduced review permissions. Edit their permission set explicitly if needed.

## Features and permissions

| Feature | Permission | Behavior |
| --- | --- | --- |
| Dashboard | Active core access | Real counts, available shortcuts, personal recent requests and permitted announcements. |
| Inbox notifications | `core:inbox:self` | Own notifications only; mark one or all as read. |
| Personal requests | `core:requests:self` | Create general, service or access requests; read own records; cancel an open request. |
| Request review | `core:requests:review` | Review other users' general/service/access requests with a response and audit history. |
| Ideas | `core:ideas:submit` | Submit ideas; see open/approved ideas and own closed ideas; vote for other users' open ideas. |
| Idea review | `core:ideas:review` | Review others' ideas; rejected/cancelled ideas are visible only to their author and reviewers. |
| Announcements | `core:announcements:view` | Read published announcements. |
| Announcement management | `core:announcements:manage` | Publish, archive and restore announcements. |
| Organization directory | `core:organization:view` | Search active colleagues by name/work email and filter their active subsystem affiliations. |

Requests start `OPEN`; a reviewer may set `IN_REVIEW`, `APPROVED` or `REJECTED`. Rejection requires a reason. Only the author may cancel an open/in-review request. Terminal states cannot be reopened. Nobody, including a superadmin, may approve their own request. Competing status updates are guarded atomically, and voting is serialized against idea closure.

Requests create notifications for eligible reviewers, and reviewer responses notify the author. Notifications are internal to the portal; no email or SMS is sent. Approving an access request records a decision and does not grant account privileges; the scoped administrator changes the user's group memberships separately.

## Database and API

The additive migration `20261013000000_core_portal` creates request, history, notification, announcement and idea-vote tables. It does not change existing account or group data. Actor names are stored as historical snapshots; actor identifiers also support the configured environment superadmin without creating a database account.

Core endpoints are under `/api/core`: `overview`, `requests`, `requests/:id`, `requests/:id/vote`, `notifications`, `announcements`, `announcements/:id` and `organization`. All routes read the current authenticated account and effective group permissions. Disabled core access is rejected even for a superadmin. Data is returned without cache storage. Notification reads are always scoped to the current recipient.

For a fresh deployment, load the intended environment, generate the Prisma client, run `prisma migrate deploy`, and restart the app. Next.js uses `.env.local` before `.env`; Prisma CLI must receive the same `DATABASE_URL` when these differ.

## Verification and current scope

`npm run test:access` covers 21 account/group and core integration scenarios in an isolated PostgreSQL schema, including ownership, reviewer authorization, concurrent decisions, voting, archive/restore, inactive accounts and revoked sessions. `npm run build` checks the production build and TypeScript.

Browser checks cover employee submission, superadmin review, announcement publication, notification reading, directory search, logout, and responsive navigation. `docs/core-portal-preview.png` shows synthetic data from the isolated QA environment; sample accounts and records are not inserted into the application database.

This is the basic core subsystem. Lists of requests, ideas, announcements and notifications show up to 100 recent records; pagination, attachments, email delivery, multi-stage approvals and a separately maintained organization hierarchy are not included. The directory reflects actual account/subsystem affiliations. HR, HSE and other business subsystems remain represented by the original mockups and permission catalog.
