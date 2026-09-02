'use client';

import { use } from 'react';
import { CitizenEditor } from '@/components/admin/citizen-editor';

/**
 * Correct a registration still sitting in this device's offline queue.
 *
 * Under `citizens/queue/[queueId]` rather than `citizens/[citizenId]/edit` —
 * this is not yet a citizen the server has heard of, so there is no
 * `citizenId` to route on, only the id the browser minted when it queued the
 * submission. `queue` is a literal segment sitting beside `new`, matching the
 * reasoning `citizens/new` already documents: Next resolves it as a static
 * path before it ever considers the dynamic `[citizenId]` segment, so an id
 * beginning with the four letters "queue" — vanishingly unlikely for a UUID,
 * but not impossible — can never be misread as this route.
 */
export default function EditQueuedCitizenPage({
  params,
}: {
  params: Promise<{
    tenant: string;
    locale: string;
    adminPath: string;
    queueId: string;
  }>;
}) {
  const { tenant, locale, adminPath, queueId } = use(params);
  return (
    <CitizenEditor tenant={tenant} locale={locale} adminPath={adminPath} queueId={queueId} />
  );
}
