import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page: one action, متابعة الطلب.
 *
 * Self-service registration is no longer filed here. A claim is now entered by
 * a municipality clerk from the documents the citizen brings to the counter —
 * see the admin citizens registry — which means this page has exactly one job
 * left: get someone who has already filed back into their own record. The
 * either/or that used to sit here (تقديم طلب جديد beside الدخول) would now
 * offer a route that ends in a form nobody is meant to fill in themselves.
 *
 * The old "what you need before you start" checklist went with it. It listed
 * the documents to have in hand *while filling in the wizard*; as preparation
 * for a visit to the municipality it is still useful, so it is kept — reworded
 * for the counter rather than the browser.
 */
export default async function TenantHome({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = await params;
  const base = `/${tenant}/${locale}`;

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold leading-snug tracking-tight">
          تابع طلب تسجيل عقارك
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          سجّل الدخول لمتابعة حالة طلبك والاطلاع على الرسوم المستحقة عليك. لتقديم طلب
          جديد، يرجى مراجعة البلدية مع أوراقك الثبوتية.
        </p>
      </div>

      {/*
        A single card, kept at the same tap size the pair used to share. Made
        full-width on a phone and half-width from `sm` up rather than allowed to
        stretch across a desktop: a lone 11rem-tall band spanning the whole page
        reads as a banner, not as something to press.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`${base}/login`}
          className="flex min-h-[11rem] flex-col justify-between rounded-lg bg-primary p-6 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:col-span-1"
        >
          <span className="text-2xl font-bold">الدخول لمتابعة طلبي</span>
          <span className="text-base opacity-90">
            برقم هاتفك — نرسل لك رمزاً برسالة نصية
          </span>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ما الذي تحتاجه عند مراجعة البلدية</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-muted-foreground">
            {[
              'وثيقة إثبات: هوية، إخراج قيد، دفتر سواقة، أو جواز سفر',
              'رقم العقار كما هو مدوّن على سند الملكية، ومساحة الوحدة التقريبية',
              'سند الملكية إن كنت مالكاً، أو عقد الإيجار إن كنت مستأجراً',
            ].map((item, index) => (
              <li key={item} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
                >
                  {'١٢٣'[index]}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
