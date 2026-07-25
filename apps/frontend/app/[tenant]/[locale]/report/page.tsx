import { notFound } from 'next/navigation';
import { RegistrationWizard } from '@/components/citizen/registration-wizard';
import type { PublicTenantConfig } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function getConfig(slug: string): Promise<PublicTenantConfig | null> {
  try {
    const response = await fetch(`${API_URL}/t/${slug}/tenant/config`, {
      next: { revalidate: 300 },
    });
    return response.ok ? ((await response.json()) as PublicTenantConfig) : null;
  } catch {
    return null;
  }
}

/**
 * The wizard needs the municipality's enabled property types and required
 * documents before the first step renders, so the config is fetched
 * server-side and handed down rather than fetched again on the client.
 */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = await params;
  const config = await getConfig(tenant);

  if (!config) notFound();

  return <RegistrationWizard tenant={tenant} locale={locale} config={config} />;
}
