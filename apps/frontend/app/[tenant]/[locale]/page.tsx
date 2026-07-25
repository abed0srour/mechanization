import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page: a deliberate either/or, not a login wall and not a form with a
 * hidden login link. Most first-time visitors are here to file something, so
 * that action leads — but tracking an existing request is given equal weight
 * and equal tap size, because a small "sign in" link is invisible to the
 * elderly citizens this service exists for.
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
          سجّل عقارك أو وحدتك السكنية
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          التسجيل يستغرق حوالي عشر دقائق. يمكنك تسجيل أكثر من عقار في الطلب نفسه.
          احتفظ بوثيقة إثبات الهوية وإثبات الملكية أو عقد الإيجار بالقرب منك.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`${base}/report`}
          className="flex min-h-[11rem] flex-col justify-between rounded-lg bg-primary p-6 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <span className="text-2xl font-bold">تقديم طلب جديد</span>
          <span className="text-base opacity-90">
            املأ الاستمارة خطوة بخطوة — لا حاجة لحساب مسبق
          </span>
        </Link>

        <Link
          href={`${base}/login`}
          className="flex min-h-[11rem] flex-col justify-between rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <span className="text-2xl font-bold">الدخول لمتابعة طلبي</span>
          <span className="text-base text-muted-foreground">
            برقم هاتفك — نرسل لك رمزاً برسالة نصية
          </span>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ما الذي تحتاجه قبل البدء</CardTitle>
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
