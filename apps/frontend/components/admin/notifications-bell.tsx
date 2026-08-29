'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, CheckCircle2, Inbox } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getPendingPayments, logApiError, type PendingPayment } from '@/lib/api-client';
import { formatLbp, formatLbpCompact } from '@/lib/currency';
import { formatDate } from '@/lib/dates';

/**
 * A minute is short enough that a clerk confirming a transfer at the counter
 * sees the queue drain while the citizen is still standing there, and long
 * enough that a portal left open all day costs the API about 500 requests.
 */
const POLL_INTERVAL_MS = 60_000;

/**
 * Mirrors `@Roles('SUPER_ADMIN', 'AUDITOR')` on `GET /fees/payments/pending`.
 *
 * Checked here as well as server-side so a cashier is never shown a bell that
 * can only ever answer 403 — the guard is the server's, but a control that is
 * guaranteed to fail should not be rendered at all.
 */
const REVIEW_ROLES = ['SUPER_ADMIN', 'AUDITOR'];

/** Past this the panel is a page, not a glance. The rest are one tap away. */
const MAX_LISTED = 6;

/**
 * Pending-payment notifications.
 *
 * The one queue in this portal where someone outside the building is waiting:
 * a citizen has declared a Whish transfer and cannot be credited until a clerk
 * confirms the money arrived. Until now it was visible only to whoever thought
 * to open «الرسوم والمدفوعات» and scroll to the third section, so a declaration
 * made at 09:00 could sit unseen all day.
 *
 * Deliberately not a general notification system. There is no notifications
 * table behind this and no read/unread state to keep — it reads the same
 * `fees/payments/pending` endpoint the fees page already uses, so the badge is
 * the live length of the work queue rather than a count of events someone has
 * to dismiss. Nothing to mark read, nothing to go stale.
 */
export function NotificationsBell({
  tenant,
  token,
  role,
  base,
}: {
  tenant: string;
  token: string | undefined;
  role: string | undefined;
  base: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<PendingPayment[]>([]);
  const canReview = Boolean(role && REVIEW_ROLES.includes(role));

  const reviewHref = `${base}/fees#verify`;

  useEffect(() => {
    if (!token || !canReview) return;
    let cancelled = false;

    const load = async (): Promise<void> => {
      // A poll on a backgrounded tab is a request nobody is waiting for, and
      // this one runs for as long as the portal is open.
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await getPendingPayments(tenant, token);
        if (!cancelled) setItems(result.items);
      } catch (caught) {
        // Silent by design: this fires every minute, and a toast per failure
        // would bury the page under a single flaky connection.
        logApiError(caught);
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    // Returning to the tab should not have to wait out the rest of the
    // interval — the count on screen is the first thing the reader looks at.
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // `pathname` is in here so confirming a payment and navigating away
    // refreshes the count on arrival rather than a minute later.
  }, [tenant, token, canReview, pathname]);

  const openQueue = useCallback(() => router.push(reviewHref), [router, reviewHref]);

  if (!canReview) return null;

  const count = items.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={
            count > 0 ? `الإشعارات، ${count} دفعة بانتظار التأكيد` : 'الإشعارات، لا جديد'
          }
        >
          <Bell className="size-5" />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute -end-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold tabular-nums text-destructive-foreground"
            >
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      {/* `max-w-[calc(100vw-1rem)]`: at 360px a fixed 22rem panel is wider than
          the screen, and a dropdown cannot scroll sideways to reveal itself. */}
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 px-3 py-2.5">
          <span className="text-sm font-semibold">بانتظار التأكيد</span>
          {count > 0 ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive">
              {count}
            </span>
          ) : null}
        </DropdownMenuLabel>
        {/* `mx-0` undoes the primitive's `-mx-1`, which is sized for a panel
            with `p-1`. This one is `p-0`, so the default bleeds the rule 4px
            past the rounded edge on both sides. */}
        <DropdownMenuSeparator className="mx-0 my-0" />

        {count === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success"
            >
              <CheckCircle2 className="size-5" />
            </span>
            <p className="text-sm font-medium">لا شيء بانتظار المراجعة</p>
            <p className="text-xs text-muted-foreground">
              كل ما أعلنه المواطنون تمّت معالجته.
            </p>
          </div>
        ) : (
          <>
            {/* A plain scroll container rather than `<ul>`/`<li>`: Radix puts
                `role="menu"` on the panel and `role="menuitem"` on each row,
                and that pairing requires no `role="list"` in between — a list
                wrapper here makes a screen reader announce a list of items
                inside a menu and lose the menu's own item count. */}
            <div className="max-h-[min(60vh,22rem)] overflow-y-auto">
              {items.slice(0, MAX_LISTED).map((payment) => (
                <DropdownMenuItem
                  key={payment.id}
                  onSelect={openQueue}
                  className="flex-col items-stretch gap-1 px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {payment.citizenName}
                    </span>
                    {/* The compact form with the exact figure in `title`,
                        rather than `<Money>`: that renders a Radix tooltip,
                        and a tooltip opened from inside an open dropdown
                        fights it for the focus trap. */}
                    <span
                      title={formatLbp(payment.amount)}
                      className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums"
                    >
                      {formatLbpCompact(payment.amount)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{payment.title}</span>
                    <span className="shrink-0 whitespace-nowrap">
                      استحقاق {formatDate(payment.dueDate)}
                    </span>
                  </div>
                  {payment.paymentMethod ? (
                    <span className="text-xs text-muted-foreground">
                      {ar.paymentMethod?.[payment.paymentMethod as never] ?? payment.paymentMethod}
                      {payment.whishTransactionRef ? ` · ${payment.whishTransactionRef}` : ''}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator className="mx-0 my-0" />
            <DropdownMenuItem onSelect={openQueue} className="justify-center px-3 py-2.5">
              <Inbox className="size-4" aria-hidden />
              <span className="text-sm font-medium">
                {count > MAX_LISTED ? `عرض الكل (${count})` : 'فتح قائمة التأكيد'}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
