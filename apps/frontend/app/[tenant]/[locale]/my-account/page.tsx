import { ar } from '@mechanization/shared-schemas';

/**
 * Citizen account view: every submission with its current status, plus the
 * reference number they can quote at the municipality counter.
 *
 * Server data wiring lands with the account session work; the shape below is
 * what the endpoint returns.
 */
export default async function MyAccount() {
  const registrations: {
    id: string;
    referenceNumber: string;
    status: keyof typeof ar.reportStatus;
    submittedAt: string;
    properties: { id: string; propertyNumber: string }[];
  }[] = [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">طلباتي</h1>

      {registrations.length === 0 ? (
        <div className="rounded-card border-2 border-dashed border-rule bg-card p-8 text-center">
          <p className="text-muted">لا توجد طلبات مسجّلة بعد على هذا الرقم.</p>
          <a
            href="./report"
            className="mt-4 inline-block min-h-touch rounded-card border-2 border-cedar bg-cedar px-6 py-3 font-medium text-card"
          >
            تقديم طلب جديد
          </a>
        </div>
      ) : (
        <ul className="space-y-4">
          {registrations.map((registration) => (
            <li key={registration.id} className="rounded-card border-2 border-rule bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display font-bold" dir="ltr">
                    {registration.referenceNumber}
                  </p>
                  <p className="text-sm text-muted">
                    {registration.properties.length} عقار
                  </p>
                </div>
                <span className="stamp px-3 py-1 text-sm">
                  {ar.reportStatus[registration.status]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
