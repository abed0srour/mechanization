/**
 * Mirrors the aggregate's ALLOWED_TRANSITIONS (see `registration.entity.ts`).
 *
 * Duplicated on the client only to avoid offering a move the server will
 * refuse — the server stays the authority, and a mismatch surfaces as a
 * rejected click rather than a bad write. Lives here rather than in a page so
 * the dashboard and the review screen cannot drift into two different ideas of
 * what a reviewer may do next.
 */
export function nextStatusesFor(status: string): string[] {
  switch (status) {
    case 'PENDING':
      return ['UNDER_REVIEW', 'REJECTED'];
    case 'UNDER_REVIEW':
      return ['VERIFIED', 'REJECTED'];
    case 'VERIFIED':
      return ['APPROVED', 'REJECTED'];
    default:
      return [];
  }
}

/** The forward move behind a single "قبول" button — everything but refusal. */
export function acceptStatusFor(status: string): string | undefined {
  return nextStatusesFor(status).find((next) => next !== 'REJECTED');
}

/** Whether this claim is still open to a decision at all. */
export function isReviewable(status: string): boolean {
  return nextStatusesFor(status).length > 0;
}
