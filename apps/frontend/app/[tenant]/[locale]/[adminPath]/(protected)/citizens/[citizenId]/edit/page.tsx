'use client';

import { use } from 'react';
import { CitizenEditor } from '@/components/admin/citizen-editor';

/** Correct a citizen already on file. Same form as `citizens/new`, seeded. */
export default function EditCitizenPage({
  params,
}: {
  params: Promise<{
    tenant: string;
    locale: string;
    adminPath: string;
    citizenId: string;
  }>;
}) {
  const { tenant, locale, adminPath, citizenId } = use(params);
  return (
    <CitizenEditor
      tenant={tenant}
      locale={locale}
      adminPath={adminPath}
      citizenId={citizenId}
    />
  );
}
