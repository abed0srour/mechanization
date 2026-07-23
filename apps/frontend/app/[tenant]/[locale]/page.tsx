import Link from 'next/link';

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
        <h1 className="font-display text-3xl font-bold leading-snug">
          سجّل عقارك أو وحدتك السكنية
        </h1>
        <p className="max-w-prose text-lg text-muted">
          التسجيل يستغرق حوالي عشر دقائق. يمكنك تسجيل أكثر من عقار في الطلب نفسه.
          احتفظ بوثيقة إثبات الهوية وإثبات الملكية أو عقد الإيجار بالقرب منك.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`${base}/report`}
          className="group flex min-h-[11rem] flex-col justify-between rounded-card border-2 border-cedar bg-cedar p-6 text-card transition hover:brightness-110"
        >
          <span className="font-display text-2xl font-bold">تقديم طلب جديد</span>
          <span className="text-base opacity-90">
            املأ الاستمارة خطوة بخطوة — لا حاجة لحساب مسبق
          </span>
        </Link>

        <Link
          href={`${base}/login`}
          className="group flex min-h-[11rem] flex-col justify-between rounded-card border-2 border-cedar bg-card p-6 text-ink transition hover:bg-cedar-soft"
        >
          <span className="font-display text-2xl font-bold">الدخول لمتابعة طلبي</span>
          <span className="text-base text-muted">
            برقم هاتفك — نرسل لك رمزاً برسالة نصية
          </span>
        </Link>
      </div>

      <section className="rounded-card border border-rule bg-card p-6">
        <h2 className="font-display text-lg font-bold">ما الذي تحتاجه قبل البدء</h2>
        <ul className="mt-4 space-y-3 text-muted">
          <li className="flex gap-3">
            <span aria-hidden className="stamp stamp--pending px-2 py-0.5 text-sm">١</span>
            وثيقة إثبات: هوية، إخراج قيد، دفتر سواقة، أو جواز سفر
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="stamp stamp--pending px-2 py-0.5 text-sm">٢</span>
            رقم العقار، ومساحة الوحدة التقريبية
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="stamp stamp--pending px-2 py-0.5 text-sm">٣</span>
            سند الملكية إن كنت مالكاً، أو عقد الإيجار إن كنت مستأجراً
          </li>
        </ul>
      </section>
    </div>
  );
}
