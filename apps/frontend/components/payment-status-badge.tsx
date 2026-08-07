import { AlertTriangle, CheckCircle2, Clock, Hourglass } from 'lucide-react';
import { ar, type PaymentStatus } from '@mechanization/shared-schemas';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Where a payment stands, rendered once.
 *
 * `badge.tsx` explains why the old generic `StatusBadge` was deleted: it served
 * a طلب's review state *and* a payment's state from one component, and "a
 * generic badge serving two unrelated vocabularies is how the two drift". That
 * reasoning stands. This is not that component — it serves exactly one
 * vocabulary, `PaymentStatus`, and is typed to the enum so it cannot quietly
 * grow a second.
 *
 * What it replaces is the alternative, which drifted worse: the same four
 * states were spelled out by hand in four places, and by the time they were
 * collected here no two agreed.
 *
 *   fees/page.tsx            tokens, correct — the version this one adopts
 *   citizens/[id]/page.tsx   hardcoded palette, PENDING_REVIEW blue
 *   (citizen)/payments       hardcoded palette, PENDING_REVIEW yellow, and
 *                            missing the `dark:` correction the admin copy had
 *   staff/page.tsx           hardcoded emerald for an unrelated "active" pill
 *
 * The citizen-facing screen — the one a resident sees, and the only one whose
 * reader cannot ask a clerk what the colour meant — was the copy that missed
 * the dark-mode fix.
 *
 * ── On PENDING_REVIEW ──────────────────────────────────────────────────────
 * The three copies disagreed on more than class strings: قيد المراجعة was
 * amber on one screen, yellow on another and blue on a third. Blue wins, which
 * is the admin profile's choice. مطلوب and قيد المراجعة are different in the
 * way that matters to whoever is looking — مطلوب is money the citizen still
 * owes, قيد المراجعة is a claim already filed and now the municipality's turn
 * to act. Painting both amber, as the fees screen's ternary did, tells a
 * citizen who has already paid that they still owe.
 *
 * Colour is never the only channel: each state carries its own icon, so the
 * four remain distinguishable under any colour vision deficiency and in the
 * printed وصل قبض.
 *
 * Every pairing below is measured as text on its own `/10` tint over a card —
 * the form it actually renders in — and clears AA in both themes: 4.66–5.53:1
 * light, 4.62–6.95:1 dark.
 */
const TONE: Record<PaymentStatus, string> = {
  UNPAID: 'border-warning/40 bg-warning/10 text-warning',
  PENDING_REVIEW: 'border-primary/40 bg-primary/10 text-primary',
  PAID: 'border-success/40 bg-success/10 text-success',
  OVERDUE: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const ICON: Record<PaymentStatus, React.ComponentType<{ className?: string }>> = {
  UNPAID: Clock,
  PENDING_REVIEW: Hourglass,
  PAID: CheckCircle2,
  OVERDUE: AlertTriangle,
};

export function PaymentStatusBadge({
  status,
  className,
  showIcon = true,
}: {
  status: PaymentStatus;
  className?: string;
  /** Off where the row is already tight and the label alone carries it. */
  showIcon?: boolean;
}): React.JSX.Element {
  const Icon = ICON[status];

  return (
    <Badge variant="outline" className={cn('shrink-0 gap-1.5', TONE[status], className)}>
      {showIcon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {ar.paymentStatus[status]}
    </Badge>
  );
}
