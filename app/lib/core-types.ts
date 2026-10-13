export type CoreView = "dashboard" | "inbox" | "requests" | "ideas" | "announcements" | "organization";
export type RequestKind = "GENERAL" | "ACCESS" | "SERVICE" | "IDEA";
export type RequestStatus = "OPEN" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED";
export const REQUEST_KINDS: Record<RequestKind, string> = {GENERAL: "درخواست عمومی", ACCESS: "درخواست دسترسی", SERVICE: "درخواست خدمات", IDEA: "ایده و پیشنهاد"};
export const REQUEST_STATUS: Record<RequestStatus, string> = {OPEN: "ثبت شده", IN_REVIEW: "در حال بررسی", APPROVED: "تأیید شده", REJECTED: "رد شده", CANCELLED: "لغو شده"};
export type CoreRequestItem = {
  id: string; number: number; kind: RequestKind; title: string; description: string;
  priority: string; status: RequestStatus; ownerId: string; ownerName: string;
  response: string | null; createdAt: string; updatedAt: string; voteCount: number; voted: boolean;
  events: {id: string; actorName: string; status: RequestStatus; note: string | null; createdAt: string}[];
};
export type CoreNotice = {id: string; title: string; body: string; requestId: string | null; readAt: string | null; createdAt: string};
export type CoreAnnouncementItem = {id: string; title: string; body: string; authorName: string; important: boolean; archivedAt: string | null; createdAt: string};
export type DirectoryMember = {id: string; name: string; email: string; role: string; departments: string[]};
export type CoreOverview = {openRequests: number; completedRequests: number; pendingReview: number; unread: number; ideas: number; recentRequests: CoreRequestItem[]; announcements: CoreAnnouncementItem[]};
