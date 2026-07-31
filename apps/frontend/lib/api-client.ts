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
    // `.message` stays the plain, citizen/staff-facing text shown in the UI —
    // `.name` is what Error's own `toString()` (and every console.error /
    // uncaught-exception overlay) prefixes it with, so logging this anywhere
    // reads as "error (404): <message>" without a second formatted string to
    // keep in sync.
    this.name = status === 0 ? 'error (network)' : `error (${status})`;
  }

  /** Field-level messages, keyed by path, for highlighting the offending input. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.payload.details ?? []).map((detail) => [detail.path, detail.message]),
    );
  }
}

/**
 * Console-log any caught error in a consistent, scannable shape —
 * `error (404): <message>` for a failed request, or the error as-is for
 * anything that isn't an `ApiRequestError`. Call this at the top of every
 * catch block around a `getX`/`postX`/`deleteX` call: today those are caught
 * and turned straight into a UI banner with nothing printed anywhere, so a
 * failing request is invisible to whoever is debugging it unless they
 * reproduce it by hand.
 */
export function logApiError(caught: unknown): void {
  console.error(caught);
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

/**
 * The municipality's public branding and enabled property types.
 * Unauthenticated — it renders the citizen wizard before anyone signs in.
 */
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

/**
 * Issues a login code. `attempt` is the resend counter: from the second
 * the server switches SMS route rather than retrying the one that failed.
 */
export function requestOtp(tenant: string, phone: string, attempt: number) {
  return apiFetch<{
    sent: boolean;
    /** False when the server has OTP switched off — skip straight to sign-in. */
    otpRequired: boolean;
    channel: string;
    expiresAt: string;
    resendAvailableAt: string;
    devCode?: string;
  }>(tenant, '/auth/citizen/otp/request', {
    method: 'POST',
    body: JSON.stringify({ phone, attempt }),
  });
}

/**
 * Exchanges the code for a session, or for a profile choice when one
 * phone belongs to several household members.
 */
export function verifyOtp(
  tenant: string,
  input: { phone: string; code?: string; citizenId?: string },
) {
  return apiFetch<VerifyOtpResponse>(tenant, '/auth/citizen/otp/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type StaffLoginResponse = Session | { status: 'TOTP_REQUIRED' };

/**
 * Staff sign-in. Comes back with `TOTP_REQUIRED` instead of a session
 * when the account is a SUPER_ADMIN that has not sent its second factor.
 */
export function loginStaff(
  tenant: string,
  input: { email: string; password: string; totpToken?: string; remember?: boolean },
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
  /** Contact number, so the staff table can call without opening the profile. */
  citizenPhone: string | null;
  /** Reviewer's note on a refused claim — what the applicant must fix. */
  rejectionReason: string | null;
  /** Dot-paths from `REJECTABLE_FIELDS`; empty unless refused field-by-field. */
  rejectedFields: string[];
  /** False when the citizen must come in person instead of correcting online. */
  citizenCanCorrect: boolean;
  /** Optional appointment for that visit, ISO-8601. */
  revisitAt: string | null;
}

/** The signed-in citizen's own submissions, for متابعة طلبي. */
export function listMyRegistrations(tenant: string, token: string) {
  return apiFetch<{ items: RegistrationListItem[] }>(tenant, '/registrations/mine', { token });
}

/** The staff review queue, newest first. `status` narrows it to one state. */
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

/** Headline totals for the dashboard cards. Cached server-side. */
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
  buildingName: string | null;
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

/**
 * Parcels that have at least one registration, grouped for the map — one
 * marker per cadastral number, with everyone registered on it.
 */
export function getRegisteredParcels(tenant: string, token: string) {
  return apiFetch<{ parcels: RegisteredParcel[] }>(tenant, '/dashboard/map/parcels', { token });
}

// ───────────────────────────  Zones (القطاعات)  ───────────────────────────

/** A sector as the list and legend show it — membership summarised to a count. */
export interface ZoneSummary {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string | null;
  parcelCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A sector opened for editing, carrying the parcel numbers it owns. */
export interface ZoneDetail extends ZoneSummary {
  parcelNumbers: string[];
}

export interface ZoneWriteInput {
  name: string;
  code: string;
  color: string;
  description?: string;
  parcelNumbers: string[];
}

/** Every sector with its parcel count, for the list and the map legend. */
export function getZones(tenant: string, token: string) {
  return apiFetch<{ zones: ZoneSummary[] }>(tenant, '/zones', { token });
}

/** One sector including the parcel numbers it owns, for the editor. */
export function getZone(tenant: string, token: string, id: string) {
  return apiFetch<ZoneDetail>(tenant, `/zones/${encodeURIComponent(id)}`, { token });
}

/** SUPER_ADMIN only, server-enforced. */
export function createZone(tenant: string, token: string, input: ZoneWriteInput) {
  return apiFetch<ZoneDetail>(tenant, '/zones', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** SUPER_ADMIN only. Omitted fields are left as they are. */
export function updateZone(
  tenant: string,
  token: string,
  id: string,
  input: Partial<ZoneWriteInput>,
) {
  return apiFetch<ZoneDetail>(tenant, `/zones/${encodeURIComponent(id)}`, {
    token,
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** SUPER_ADMIN only. Releases the sector's parcels rather than altering them. */
export function deleteZone(tenant: string, token: string, id: string) {
  return apiFetch<{ deleted: boolean }>(tenant, `/zones/${encodeURIComponent(id)}`, {
    token,
    method: 'DELETE',
  });
}

/**
 * The zone overlay both maps draw, as dissolved polygons.
 *
 * Served from the API rather than as a static file like the cadastre layers,
 * because zone membership changes whenever an admin saves the editor.
 */
export function getZonesGeoJson(tenant: string, token: string) {
  return apiFetch<GeoJSON.FeatureCollection>(tenant, '/zones/geojson', { token });
}

/** One unit inside a BUILDING — شقة, عيادة or محل. */
export interface CitizenProfileUnit {
  id: string;
  unitType: string;
  floor: string;
  side: string | null;
  unitArea: number;
  sharedRights: string[];
}

export interface CitizenProfileProperty {
  id: string;
  neighborhood: string;
  propertyNumber: string;
  propertyType: string;
  occupancyType: string;
  /** TENANT only. */
  landlordName: string | null;
  landlordPhone: string | null;
  buildingName: string | null;
  /** HOUSE/LAND carry these directly; a BUILDING keeps them per unit. */
  unitType: string | null;
  landType: string | null;
  floor: string | null;
  side: string | null;
  tentLocation: string | null;
  unitArea: number | null;
  sharedRights: string[];
  latitude: number | null;
  longitude: number | null;
  unitCount: number;
  units: CitizenProfileUnit[];
}

export interface CitizenProfileDocument {
  id: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  propertyEntryId: string | null;
  createdAt: string;
}

export interface CitizenProfileRegistration {
  id: string;
  referenceNumber: string;
  status: string;
  submittedAt: string;
  /** Reviewer's note, and the fields they flagged — see `REJECTABLE_FIELDS`. */
  rejectionReason: string | null;
  rejectedFields: string[];
  properties: CitizenProfileProperty[];
  documents: CitizenProfileDocument[];
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
  maritalStatus: string | null;
  referenceNumber: string | null;
  registeredAt: string;
  registrations: CitizenProfileRegistration[];
}

/**
 * One citizen and everything they have filed. Staff-only: the response
 * carries identity-document numbers and residency status.
 */
export function getCitizenProfile(tenant: string, token: string, citizenId: string) {
  return apiFetch<CitizenProfile>(tenant, `/citizens/${encodeURIComponent(citizenId)}`, { token });
}

/** Opens the signed URL in a new tab; the backend records who viewed what. */
export function getDocumentViewUrl(tenant: string, token: string, documentId: string) {
  return apiFetch<{ url: string; expiresInSeconds: number }>(
    tenant,
    `/documents/${encodeURIComponent(documentId)}/url`,
    { token },
  );
}

// ───────────────────────────  Staff accounts  ───────────────────────────

export interface StaffSummary {
  id: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  /** Audit entries + reviewed registrations. A permanent delete needs zero. */
  historyCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Every staff account with the history count that gates a permanent delete. */
export function getStaff(tenant: string, token: string) {
  return apiFetch<{ items: StaffSummary[] }>(tenant, '/staff', { token });
}

/**
 * Creates an account. `confirmPassword` is deliberately not sent — it is a
 * typo guard for whoever is typing, not something the server can verify.
 */
export function createStaff(
  tenant: string,
  token: string,
  input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
  },
) {
  return apiFetch<{ id: string }>(tenant, '/staff', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Partial update. An omitted `password` leaves the current one alone. */
export function updateStaff(
  tenant: string,
  token: string,
  id: string,
  input: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  },
) {
  return apiFetch<{ updated: boolean }>(tenant, `/staff/${encodeURIComponent(id)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Soft delete and its undo. */
export function setStaffActive(tenant: string, token: string, id: string, isActive: boolean) {
  return apiFetch<{ isActive: boolean }>(tenant, `/staff/${encodeURIComponent(id)}/active`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}

/** Permanent — the server refuses it for any account that has already acted. */
export function deleteStaff(tenant: string, token: string, id: string) {
  return apiFetch<{ deleted: boolean }>(tenant, `/staff/${encodeURIComponent(id)}`, {
    token,
    method: 'DELETE',
  });
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorType: string;
  actorRole: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
}

/** SUPER_ADMIN/AUDITOR only, server-enforced. Omitting `actorId` returns
 * every administrative action; passing it (e.g. the signed-in user's own id)
 * narrows the trail down to one admin's activity. */
export function getAuditLog(
  tenant: string,
  token: string,
  filter: { actorId?: string; entityType?: string; from?: string; to?: string; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (filter.actorId) query.set('actorId', filter.actorId);
  if (filter.entityType) query.set('entityType', filter.entityType);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  query.set('limit', String(filter.limit ?? 100));

  return apiFetch<{ items: AuditEntry[]; total: number }>(tenant, `/audit?${query}`, { token });
}

export interface CadastreImportResult {
  parcelsImported: number;
  parcelsSkipped: number;
  linesImported: number;
}

/** SUPER_ADMIN only — rebuilds the parcel registry and the map's static
 * cartography layer from an uploaded GeoJSON file. */
export function importCadastre(tenant: string, token: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<CadastreImportResult>(tenant, '/cadastre/import', {
    method: 'POST',
    token,
    body: form,
  });
}

/** A rejected claim plus the values the citizen is being asked to fix. */
export interface CorrectionContext {
  registrationId: string;
  referenceNumber: string;
  status: string;
  rejectionReason: string | null;
  rejectedFields: string[];
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
}

/**
 * The reviewer's note, the flagged fields, and the values behind them.
 * Scoped to the signed-in citizen server-side.
 */
export function getCorrection(tenant: string, token: string, registrationId: string) {
  return apiFetch<CorrectionContext>(
    tenant,
    `/registrations/mine/${encodeURIComponent(registrationId)}/correction`,
    { token },
  );
}

/**
 * Sends corrected values and returns the claim to the review queue. The
 * server ignores any field the reviewer did not flag.
 */
export function submitCorrection(
  tenant: string,
  token: string,
  registrationId: string,
  body: {
    personal?: Record<string, unknown>;
    contact?: Record<string, unknown>;
    properties?: Array<{ id: string } & Record<string, unknown>>;
  },
) {
  return apiFetch<{ registrationId: string; from: string; to: string }>(
    tenant,
    `/registrations/mine/${encodeURIComponent(registrationId)}/correction`,
    { token, method: 'PATCH', body: JSON.stringify(body) },
  );
}

/**
 * Moves a claim through the review lifecycle. Rejection additionally carries
 * the reviewer's note and the fields they flagged.
 */
export function changeRegistrationStatus(
  tenant: string,
  token: string,
  id: string,
  body: {
    status: string;
    reason?: string;
    rejectedFields?: string[];
    allowCitizenCorrection?: boolean;
    revisitAt?: string;
  },
) {
  return apiFetch<{ registrationId: string; from: string; to: string }>(
    tenant,
    `/registrations/${id}/status`,
    { method: 'PATCH', token, body: JSON.stringify(body) },
  );
}

// ─────────────────────────  Fees & payments  ─────────────────────────

export interface MunicipalitySettings {
  whishMoneyNumber: string | null;
  cashOfficeHours: string | null;
  cashOfficeAddress: string | null;
  updatedAt: string | null;
}

/** Readable by any signed-in user — the portal prints these on the pay modal. */
export function getMunicipalitySettings(tenant: string, token: string) {
  return apiFetch<MunicipalitySettings>(tenant, '/fees/settings', { token });
}

/** SUPER_ADMIN only, server-enforced. */
export function updateMunicipalitySettings(
  tenant: string,
  token: string,
  input: {
    whishMoneyNumber?: string;
    cashOfficeHours?: string;
    cashOfficeAddress?: string;
  },
) {
  return apiFetch<MunicipalitySettings>(tenant, '/fees/settings', {
    token,
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export interface FeeNoticeSummary {
  id: string;
  title: string;
  amount: number;
  currency: string;
  frequency: string;
  targetType: string;
  targetCategory: string | null;
  targetCitizenName: string | null;
  dueDate: string;
  instructions: string | null;
  /** How many citizens this notice actually billed. */
  issuedCount: number;
  /** False stops the recurring biller re-issuing it each period. */
  isActive: boolean;
  createdAt: string;
}

export function getFeeNotices(tenant: string, token: string) {
  return apiFetch<{ items: FeeNoticeSummary[] }>(tenant, '/fees/notices', { token });
}

/** Writes the rule and bills every matching citizen in one transaction. */
export function issueFeeNotice(
  tenant: string,
  token: string,
  input: {
    title: string;
    amount: number;
    frequency: string;
    targetType: string;
    targetCategory?: string;
    targetCitizenId?: string;
    dueDate: string;
    instructions?: string;
  },
) {
  return apiFetch<{ noticeId: string; issued: number }>(tenant, '/fees/notices', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface FeeSummary {
  unpaidTotal: number;
  unpaidCount: number;
  pendingReviewCount: number;
  paidTotal: number;
  paidCount: number;
}

export function getFeeSummary(tenant: string, token: string) {
  return apiFetch<FeeSummary>(tenant, '/fees/summary', { token });
}

export interface PendingPayment {
  id: string;
  title: string;
  amount: number;
  currency: string;
  dueDate: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  citizenId: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenReference: string | null;
}

/** The clerk's queue: money claimed but not yet confirmed. */
export function getPendingPayments(tenant: string, token: string) {
  return apiFetch<{ items: PendingPayment[] }>(tenant, '/fees/payments/pending', { token });
}

export function reviewPayment(
  tenant: string,
  token: string,
  id: string,
  input: { confirmed: boolean; note?: string },
) {
  return apiFetch<{ paymentStatus: string }>(
    tenant,
    `/fees/payments/${encodeURIComponent(id)}/review`,
    { token, method: 'PATCH', body: JSON.stringify(input) },
  );
}

export interface CitizenPaymentItem {
  id: string;
  title: string;
  amount: number;
  currency: string;
  dueDate: string;
  /** `OVERDUE` is derived server-side from the due date, never stored. */
  paymentStatus: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  paidAt: string | null;
  reviewNote: string | null;
  frequency: string | null;
}

/** The signed-in citizen's own bills. */
export function getMyPayments(tenant: string, token: string) {
  return apiFetch<{ items: CitizenPaymentItem[] }>(tenant, '/fees/payments/mine', { token });
}

/** Declares a payment — moves it to PENDING_REVIEW, never straight to PAID. */
export function declarePayment(
  tenant: string,
  token: string,
  id: string,
  input: { method: string; whishTransactionRef?: string },
) {
  return apiFetch<{ paymentStatus: string }>(
    tenant,
    `/fees/payments/mine/${encodeURIComponent(id)}/declare`,
    { token, method: 'POST', body: JSON.stringify(input) },
  );
}

/**
 * Citizen sign-in by رقم مرجعي + phone. Both are required — see the note on
 * `IdentityService.loginByReference`.
 */
export function loginByReference(
  tenant: string,
  input: { referenceNumber: string; phone: string },
) {
  return apiFetch<Session>(tenant, '/auth/citizen/reference/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** One invoice as the admin ledger shows it — who owes it, and where it stands. */
export interface AdminPaymentItem {
  id: string;
  title: string;
  amount: number;
  currency: string;
  dueDate: string;
  paymentStatus: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  paidAt: string | null;
  frequency: string | null;
  citizenId: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenReference: string | null;
}

/** Every invoice, filterable by status and by who owes it. */
export function getAllPayments(
  tenant: string,
  token: string,
  filter: { status?: string; search?: string } = {},
) {
  const query = new URLSearchParams();
  if (filter.status) query.set('status', filter.status);
  if (filter.search) query.set('search', filter.search);
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch<{ items: AdminPaymentItem[] }>(tenant, `/fees/payments${suffix}`, { token });
}

/** A one-off charge against a single citizen — no notice, no recurrence. */
export function chargeCitizen(
  tenant: string,
  token: string,
  input: { citizenId: string; title: string; amount: number; dueDate: string },
) {
  return apiFetch<{ id: string }>(tenant, '/fees/payments', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Records money handed over in person. Goes straight to PAID — the clerk
 * confirming it is the clerk who took it.
 */
export function settlePayment(
  tenant: string,
  token: string,
  id: string,
  input: { method?: string; note?: string } = {},
) {
  return apiFetch<{ paymentStatus: string }>(
    tenant,
    `/fees/payments/${encodeURIComponent(id)}/settle`,
    { token, method: 'PATCH', body: JSON.stringify({ method: 'CASH', ...input }) },
  );
}

/**
 * Runs the recurring biller now instead of waiting for the nightly cron.
 * Idempotent within a period — pressing it twice yields 0 new invoices.
 */
export function runRecurringBilling(tenant: string, token: string) {
  return apiFetch<{ tenants: number; invoicesCreated: number }>(
    tenant,
    '/fees/recurring/run',
    { token, method: 'POST' },
  );
}

/** Stops or resumes the recurring biller for one notice. */
export function setNoticeActive(
  tenant: string,
  token: string,
  id: string,
  isActive: boolean,
) {
  return apiFetch<{ isActive: boolean }>(
    tenant,
    `/fees/notices/${encodeURIComponent(id)}/active`,
    { token, method: 'PATCH', body: JSON.stringify({ isActive }) },
  );
}
