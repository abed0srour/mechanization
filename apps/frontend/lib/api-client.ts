const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiError {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
  correlationId?: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiError,
  ) {
    super(payload.message);
  }

  /** Field-level messages, keyed by path, for highlighting the offending input. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.payload.details ?? []).map((detail) => [detail.path, detail.message]),
    );
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

  let response: Response;
  try {
    response = await fetch(`${API_URL}/t/${tenant}${path}`, {
      ...rest,
      headers: {
        // FormData must set its own multipart boundary — forcing a content type
        // here silently breaks every file upload.
        ...(rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    // A dropped connection mid-request is the normal case on the networks this
    // serves, not an exceptional one.
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: 'تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.',
    });
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      code: 'UNKNOWN',
      message: 'تعذّر إتمام الطلب. حاول مرة أخرى.',
    }))) as ApiError;
    throw new ApiRequestError(response.status, payload);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ─────────────────────────────  Endpoints  ─────────────────────────────

export interface PublicTenantConfig {
  slug: string;
  name: string;
  nameAr: string;
  enabledPropertyTypes: string[];
  requiredDocuments: string[];
  branding: { logoUrl?: string; primaryColor?: string; accentColor?: string };
  supportPhone?: string;
}

export function getTenantConfig(tenant: string) {
  return apiFetch<PublicTenantConfig>(tenant, '/tenant/config');
}

export interface PropertyNumberCheck {
  propertyNumber: string;
  /** In the municipality's cadastre. Null when the municipality has none. */
  inCadastre: boolean | null;
  location: { latitude: number; longitude: number; approximate: boolean } | null;
  /** Nearest real parcel numbers, offered only when the typed one is unknown. */
  suggestions: string[];
  /**
   * Neighbours already registered on this parcel. Informational only — a
   * building shares one cadastral number, so this never blocks a submission.
   */
  registeredCount: number;
}

/** Blur-check for رقم العقار while the citizen is still typing. */
export function checkPropertyNumber(tenant: string, propertyNumber: string) {
  return apiFetch<PropertyNumberCheck>(
    tenant,
    `/registrations/property-number/${encodeURIComponent(propertyNumber)}/availability`,
  );
}

export interface SubmitResponse {
  registrationId: string;
  referenceNumber: string;
  status: string;
  propertyCount: number;
  documentCount: number;
}

/** The whole wizard in one multipart request — JSON payload plus the files. */
export function submitRegistration(tenant: string, formData: FormData) {
  return apiFetch<SubmitResponse>(tenant, '/registrations', {
    method: 'POST',
    body: formData,
  });
}

export interface Session {
  accessToken: string;
  expiresIn: string;
  user: { id: string; name: string; kind: 'STAFF' | 'CITIZEN'; role?: string };
}

export interface CitizenChoice {
  id: string;
  displayName: string;
  identityDocLastDigits: string;
}

export type VerifyOtpResponse =
  | Session
  | { status: 'CHOOSE_PROFILE'; phone: string; choices: CitizenChoice[] };

export function requestOtp(tenant: string, phone: string, attempt: number) {
  return apiFetch<{
    sent: boolean;
    channel: string;
    expiresAt: string;
    resendAvailableAt: string;
    devCode?: string;
  }>(tenant, '/auth/citizen/otp/request', {
    method: 'POST',
    body: JSON.stringify({ phone, attempt }),
  });
}

export function verifyOtp(tenant: string, input: { phone: string; code: string; citizenId?: string }) {
  return apiFetch<VerifyOtpResponse>(tenant, '/auth/citizen/otp/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type StaffLoginResponse = Session | { status: 'TOTP_REQUIRED' };

export function loginStaff(
  tenant: string,
  input: { email: string; password: string; totpToken?: string },
) {
  return apiFetch<StaffLoginResponse>(tenant, '/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface RegistrationListItem {
  id: string;
  referenceNumber: string;
  status: string;
  submittedAt: string;
  /** Lets a table row link straight to the citizen's profile page. */
  citizenId: string;
  citizenName: string;
  propertyCount: number;
}

export function listMyRegistrations(tenant: string, token: string) {
  return apiFetch<{ items: RegistrationListItem[] }>(tenant, '/registrations/mine', { token });
}

export function listForReview(
  tenant: string,
  token: string,
  filter: { status?: string; limit?: number; offset?: number } = {},
) {
  const query = new URLSearchParams();
  if (filter.status) query.set('status', filter.status);
  query.set('limit', String(filter.limit ?? 25));
  query.set('offset', String(filter.offset ?? 0));

  return apiFetch<{ items: RegistrationListItem[]; total: number }>(
    tenant,
    `/registrations?${query}`,
    { token },
  );
}

export interface DashboardCounters {
  total: number;
  byStatus: Record<string, number>;
  byPropertyType: Record<string, number>;
  byResidentStatus: Record<string, number>;
  submittedLast7Days: number;
}

export function getDashboardCounters(tenant: string, token: string) {
  return apiFetch<DashboardCounters>(tenant, '/dashboard/counters', { token });
}

/** One citizen registered against a parcel, as the map drawer lists them. */
export interface ParcelRegistrant {
  citizenId: string;
  registrationId: string;
  fullName: string;
  phone: string | null;
  occupancyType: string;
  propertyType: string;
  status: string;
  registeredAt: string;
  unitCount: number;
}

/**
 * A parcel with at least one registration. The fullscreen map places an
 * interactive marker only on these — every other cadastral parcel is drawn
 * from the static GeoJSON with no dot, so a dot always means there is
 * citizen data to open.
 */
export interface RegisteredParcel {
  propertyNumber: string;
  latitude: number;
  longitude: number;
  registrants: ParcelRegistrant[];
}

export function getRegisteredParcels(tenant: string, token: string) {
  return apiFetch<{ parcels: RegisteredParcel[] }>(tenant, '/dashboard/map/parcels', { token });
}

export interface CitizenProfileProperty {
  id: string;
  propertyNumber: string;
  propertyType: string;
  occupancyType: string;
  buildingName: string | null;
  unitArea: number | null;
  latitude: number | null;
  longitude: number | null;
  unitCount: number;
}

export interface CitizenProfileRegistration {
  id: string;
  referenceNumber: string;
  status: string;
  submittedAt: string;
  properties: CitizenProfileProperty[];
}

export interface CitizenProfile {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  gender: string | null;
  nationality: string | null;
  isLebanese: boolean | null;
  residencyNumber: string | null;
  residentStatus: string | null;
  identityDocType: string | null;
  identityDocNumber: string | null;
  civilRecordNumber: string | null;
  familySize: number | null;
  referenceNumber: string | null;
  registeredAt: string;
  registrations: CitizenProfileRegistration[];
}

export function getCitizenProfile(tenant: string, token: string, citizenId: string) {
  return apiFetch<CitizenProfile>(tenant, `/citizens/${encodeURIComponent(citizenId)}`, { token });
}

export function changeRegistrationStatus(
  tenant: string,
  token: string,
  id: string,
  body: { status: string; reason?: string },
) {
  return apiFetch<{ registrationId: string; from: string; to: string }>(
    tenant,
    `/registrations/${id}/status`,
    { method: 'PATCH', token, body: JSON.stringify(body) },
  );
}
