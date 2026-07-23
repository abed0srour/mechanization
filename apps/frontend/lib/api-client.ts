const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiError {
  code: string;
  message: string;
  fields?: { path: string; message: string }[];
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly payload: ApiError) {
    super(payload.message);
  }
}

/**
 * Every call is tenant-scoped by construction: the municipality slug is part of
 * the path, so a request cannot be made without naming which municipality it
 * belongs to.
 */
export async function apiFetch<T>(
  tenant: string,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;

  const response = await fetch(`${API_URL}/t/${tenant}${path}`, {
    ...rest,
    headers: {
      ...(rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      code: 'NETWORK_ERROR',
      message: 'تعذّر الاتصال بالخادم. حاول مرة أخرى.',
    }))) as ApiError;
    throw new ApiRequestError(response.status, payload);
  }

  return response.json() as Promise<T>;
}

/** Blur-check for رقم العقار while the citizen is still typing. */
export function checkPropertyNumber(tenant: string, propertyNumber: string) {
  return apiFetch<{ propertyNumber: string; available: boolean }>(
    tenant,
    `/registrations/property-number/availability?number=${encodeURIComponent(propertyNumber)}`,
  );
}
