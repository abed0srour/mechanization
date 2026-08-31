import { IMPORT_BATCH_SIZE } from '@mechanization/shared-schemas';
import { cachedRequest, invalidateRequests } from './request-cache';
import type {
  BackupSchedule,
  CitizenImportResult,
  CurrencyCode,
  FeeFrequency,
  ImportRow,
  NumberingSequence,
  SequenceKey,
} from '@mechanization/shared-schemas';

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
  } catch (caught) {
    /*
      A cancelled request is not a failed one.

      `fetch` rejects with an `AbortError` when its signal fires, and every
      query that supersedes another fires one — typing a new search term,
      moving to the next page, switching a status tab. Folding that into
      `NETWORK_ERROR` put «تعذّر الاتصال» on screen every time a clerk
      changed their mind quickly, on a connection that was working perfectly.
      Re-thrown as-is so the caller's own cancellation handling sees it; React
      Query discards it silently, which is the correct treatment.
    */
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;

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
 * Unauthenticated — the staff entry form reads it before a tenant is known.
 */
export function getTenantConfig(tenant: string) {
  return cachedRequest(`tenant-config:${tenant}`, 5 * 60 * 1000, () =>
    apiFetch<PublicTenantConfig>(tenant, '/tenant/config'),
  );
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
   * building shares one cadastral number, so this never blocks an entry.
   */
  registeredCount: number;
}

/** Blur-check for رقم العقار while it is being typed into the entry form. */
export function checkPropertyNumber(tenant: string, propertyNumber: string) {
  return apiFetch<PropertyNumberCheck>(
    tenant,
    `/registrations/property-number/${encodeURIComponent(propertyNumber)}/availability`,
  );
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

/**
 * A session, or the second factor still owed.
 *
 * `status` is the discriminant, matching `verifyOtpResponseSchema`'s shape on
 * the citizen side. The server returns the challenge only after the password
 * has already been accepted, so reaching it means the credentials were right.
 */
export type StaffLoginResponse = Session | { status: 'TOTP_REQUIRED' };

/** Narrows the union above — a session has a token, a challenge does not. */
export function isTotpRequired(
  response: StaffLoginResponse,
): response is { status: 'TOTP_REQUIRED' } {
  return 'status' in response && response.status === 'TOTP_REQUIRED';
}

/**
 * Staff sign-in.
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

export interface DashboardCounters {
  total: number;
  byPropertyType: Record<string, number>;
  byResidentStatus: Record<string, number>;
  submittedLast7Days: number;
}

/** Headline totals for the dashboard cards. Cached. */
export function getDashboardCounters(tenant: string, token: string) {
  return cachedRequest(`dashboard-counters:${tenant}`, 30 * 1000, () =>
    apiFetch<DashboardCounters>(tenant, '/dashboard/counters', { token }),
  );
}

/** One month of the fee ledger, keyed by the month an invoice fell due. */
export interface MonthlyFees {
  /** `YYYY-MM`. */
  month: string;
  billed: number;
  collected: number;
  overdue: number;
}

/**
 * Everything the analytics dashboard plots, in one payload — so the KPI tiles
 * and the charts below them can never disagree.
 */
export interface DashboardAnalytics {
  /** Household records on file — one row per registered citizen. */
  citizenRecords: number;
  /**
   * عدد السكان: the sum of every household's عدد أفراد الأسرة, i.e. the
   * population as declared rather than a headcount of portal accounts.
   */
  populationTotal: number;
  /**
   * Households with no declared family size. They contribute nothing to
   * `populationTotal`, so it is understated by at least this many people —
   * surfaced in the UI rather than silently rounded to zero.
   */
  householdsWithoutSize: number;
  familySizes: Array<{ size: number; households: number }>;

  /** Building stock by نوع العقار — مبنى / منزل / أرض / خيمة. */
  propertiesByType: Record<string, number>;
  propertyTotal: number;

  /**
   * Units by نوع الوحدة — شقة / عيادة / محل, counted across both places a
   * unit type is stored (a building's units, and properties registered as a
   * single unit). Counting only the first drops every standalone unit.
   */
  unitsByType: Record<string, number>;
  unitTotal: number;

  billedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  /** Unpaid and past its due date. */
  overdueTotal: number;
  overdueCount: number;
  pendingReviewCount: number;

  monthly: MonthlyFees[];
}

/** The analytics dashboard's whole dataset. Cached server-side. */
export function getDashboardAnalytics(tenant: string, token: string) {
  return apiFetch<DashboardAnalytics>(tenant, '/dashboard/analytics', { token });
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
  return cachedRequest(`zones:${tenant}`, 60 * 1000, () =>
    apiFetch<{ zones: ZoneSummary[] }>(tenant, '/zones', { token }),
  );
}

/** One sector including the parcel numbers it owns, for the editor. */
export function getZone(tenant: string, token: string, id: string) {
  return apiFetch<ZoneDetail>(tenant, `/zones/${encodeURIComponent(id)}`, { token });
}

/** SUPER_ADMIN only, server-enforced. */
export async function createZone(tenant: string, token: string, input: ZoneWriteInput) {
  const result = await apiFetch<ZoneDetail>(tenant, '/zones', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
  invalidateRequests(`zones:${tenant}`);
  return result;
}

/** SUPER_ADMIN only. Omitted fields are left as they are. */
export async function updateZone(
  tenant: string,
  token: string,
  id: string,
  input: Partial<ZoneWriteInput>,
) {
  const result = await apiFetch<ZoneDetail>(tenant, `/zones/${encodeURIComponent(id)}`, {
    token,
    method: 'PUT',
    body: JSON.stringify(input),
  });
  invalidateRequests(`zones:${tenant}`);
  return result;
}

/** SUPER_ADMIN only. Releases the sector's parcels rather than altering them. */
export async function deleteZone(tenant: string, token: string, id: string) {
  const result = await apiFetch<{ deleted: boolean }>(tenant, `/zones/${encodeURIComponent(id)}`, {
    token,
    method: 'DELETE',
  });
  invalidateRequests(`zones:${tenant}`);
  return result;
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
  submittedAt: string;
  properties: CitizenProfileProperty[];
  documents: CitizenProfileDocument[];
}

/** One invoice on the citizen's profile. */
export interface CitizenProfilePayment {
  id: string;
  title: string;
  amount: number;
  /** Received so far — below `amount` on a part-settled invoice. */
  paidAmount: number;
  /** `amount - paidAmount`, floored at zero: what is still owed. */
  remaining: number;
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

/**
 * Where a citizen stands with the municipality's fees.
 *
 * `overdueTotal` is the unpaid amount past its due date. The system levies no
 * penalty on top, so a late fee *is* the unpaid fee — it is reported as its own
 * total because "owes 400,000" and "owes 400,000, all of it late" are different
 * conversations at the counter.
 */
export interface CitizenFeeTotals {
  feesTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  overdueTotal: number;
  overdueCount: number;
  pendingReviewCount: number;
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
  bloodType: string | null;
  referenceNumber: string | null;
  registeredAt: string;
  /** False for a deactivated record — kept for its history, refused a session. */
  isActive: boolean;
  registrations: CitizenProfileRegistration[];
  payments: CitizenProfilePayment[];
  fees: CitizenFeeTotals;
}

/**
 * One citizen and everything they have filed. Staff-only: the response
 * carries identity-document numbers and residency status.
 */
export function getCitizenProfile(tenant: string, token: string, citizenId: string) {
  return apiFetch<CitizenProfile>(tenant, `/citizens/${encodeURIComponent(citizenId)}`, { token });
}

/**
 * The signed-in citizen's own record: what they own and what they owe.
 *
 * Replaces `listMyRegistrations`, which reported the review status of each
 * طلب. Properties arrive flattened across filings — a citizen has no reason to
 * care that their four properties were entered in two sittings, which was an
 * artefact of the submission workflow rather than anything about the property.
 */
export interface MyCitizenSummary {
  fullName: string;
  referenceNumber: string | null;
  registeredAt: string;
  isActive: boolean;

  phone: string | null;
  whatsapp: string | null;
  gender: string | null;
  nationality: string | null;
  isLebanese: boolean | null;
  residentStatus: string | null;
  maritalStatus: string | null;
  bloodType: string | null;
  familySize: number | null;
  identityDocType: string | null;
  /**
   * Tail only — `•••567`. The full number is never sent to this route; see the
   * note on `CitizenController.mySummary` for why.
   */
  identityDocNumberMasked: string | null;
  civilRecordNumberMasked: string | null;

  properties: CitizenProfileProperty[];
  payments: CitizenProfilePayment[];
  fees: CitizenFeeTotals;
}

export function getMySummary(tenant: string, token: string) {
  return apiFetch<MyCitizenSummary>(tenant, '/citizens/me/summary', { token });
}

// ─────────────────────  Citizens registry (staff CRUD)  ─────────────────────

/** One row of the admin citizens table — pre-aggregated, including fee totals. */
export interface CitizenListItem {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  gender: string | null;
  referenceNumber: string | null;
  identityDocType: string | null;
  identityDocNumber: string | null;
  residentStatus: string | null;
  isActive: boolean;
  registeredAt: string;

  registrationCount: number;
  propertyCount: number;
  /** When this citizen last filed, if ever. */
  latestSubmittedAt: string | null;

  feesTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  /** The slice of `outstandingTotal` whose due date has passed — المتأخرات. */
  overdueTotal: number;
  overdueCount: number;
  pendingReviewCount: number;
}

/**
 * The citizen registry. `search` matches name, phone, رقم مرجعي or document
 * number server-side — the table's own search box narrows the page further in
 * the browser.
 */
export function listCitizens(
  tenant: string,
  token: string,
  filter: { search?: string; limit?: number; offset?: number } = {},
  /**
   * Cancels the request when a newer one supersedes it.
   *
   * Supplied by React Query, which fires it as soon as the query key changes —
   * a new search term, the next page, a different tab. Without it, two requests
   * for the same table race and the slower response wins, so a clerk who
   * corrects a search quickly is shown the results of the term they abandoned.
   */
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (filter.search) query.set('search', filter.search);
  query.set('limit', String(filter.limit ?? 200));
  query.set('offset', String(filter.offset ?? 0));

  return apiFetch<{
    items: CitizenListItem[];
    total: number;
    /** Computed over every matching citizen, not the returned page. */
    totals: { outstanding: number; overdue: number; inArrears: number };
  }>(tenant, `/citizens?${query}`, { token, signal });
}

/**
 * The three sections the admin form edits, exactly as it posts them back.
 *
 * `properties` carries only the citizen's most recent registration — the one
 * the form owns. Earlier claims stay visible on the profile page with their
 * own review state, so a name correction cannot silently reopen a claim
 * approved months ago.
 */
export interface CitizenFormData {
  id: string;
  registrationId: string | null;
  referenceNumber: string | null;
  status: string | null;
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
}

export function getCitizenForm(tenant: string, token: string, citizenId: string) {
  return apiFetch<CitizenFormData>(
    tenant,
    `/citizens/${encodeURIComponent(citizenId)}/form`,
    { token },
  );
}

export interface CitizenWriteInput {
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
}

/**
 * Bulk import from a spreadsheet, sent in batches.
 *
 * Sends the raw cells rather than a shaped payload: the branch rules that turn
 * a flat row into a registration live in `buildCitizenPayload` on the server,
 * next to the schema that validates the result. Shaping here would be a second
 * copy of those rules, free to drift from the one that decides what is valid.
 *
 * Batched because one request per file failed two ways at real sizes. Arabic
 * costs two bytes a character, so a few hundred rows across twenty-nine columns
 * overran the body limit and came back as a 500 `PayloadTooLargeError`; and
 * because each row opens its own transaction, a whole file in one request holds
 * the connection open for minutes. `startRow` keeps every reported row number
 * pointing at the clerk's file rather than at the batch.
 *
 * Batches run in sequence, not `Promise.all`: the server writes rows serially
 * anyway (the tenant pool is five connections), so firing them together would
 * only queue them somewhere less visible while making the progress meaningless.
 *
 * `dryRun` runs the identical path and writes nothing, which is what the
 * preview step reports.
 */
export async function importCitizens(
  tenant: string,
  token: string,
  input: {
    rows: ImportRow[];
    dryRun: boolean;
    /** Called after each batch with rows finished so far, for the progress bar. */
    onProgress?: (done: number, total: number) => void;
  },
): Promise<CitizenImportResult> {
  const merged: CitizenImportResult = {
    dryRun: input.dryRun,
    created: 0,
    failed: 0,
    results: [],
  };

  for (let offset = 0; offset < input.rows.length; offset += IMPORT_BATCH_SIZE) {
    const batch = input.rows.slice(offset, offset + IMPORT_BATCH_SIZE);

    const result = await apiFetch<CitizenImportResult>(tenant, '/citizens/import', {
      token,
      method: 'POST',
      body: JSON.stringify({
        rows: batch,
        // 1-based, and counted in the file the clerk is holding.
        startRow: offset + 1,
        dryRun: input.dryRun,
      }),
    });

    merged.created += result.created;
    merged.failed += result.failed;
    merged.results.push(...result.results);
    input.onProgress?.(Math.min(offset + batch.length, input.rows.length), input.rows.length);
  }

  return merged;
}

/** Files a citizen and their first registration. Lands as PENDING, like any claim. */
export function createCitizen(tenant: string, token: string, input: CitizenWriteInput) {
  return apiFetch<{
    citizenId: string;
    registrationId: string;
    referenceNumber: string;
    propertyCount: number;
  }>(tenant, '/citizens', { token, method: 'POST', body: JSON.stringify(input) });
}

/**
 * Replaces the citizen's details and reconciles the properties of their latest
 * registration: an entry with an `id` is updated, one without is created, and
 * a stored entry absent from the payload is deleted along with its documents.
 */
export function updateCitizen(
  tenant: string,
  token: string,
  citizenId: string,
  input: CitizenWriteInput,
) {
  return apiFetch<{ updated: boolean; citizenId: string }>(
    tenant,
    `/citizens/${encodeURIComponent(citizenId)}`,
    { token, method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** Soft delete and its undo — a deactivated citizen is skipped by the biller. */
export function setCitizenActive(
  tenant: string,
  token: string,
  citizenId: string,
  isActive: boolean,
) {
  return apiFetch<{ isActive: boolean }>(
    tenant,
    `/citizens/${encodeURIComponent(citizenId)}/active`,
    { token, method: 'PATCH', body: JSON.stringify({ isActive }) },
  );
}

/**
 * Permanent, cascading to registrations, properties, documents and invoices.
 * SUPER_ADMIN only, and the server refuses it for anyone with a settled payment.
 */
export function deleteCitizen(tenant: string, token: string, citizenId: string) {
  return apiFetch<{ deleted: boolean }>(
    tenant,
    `/citizens/${encodeURIComponent(citizenId)}`,
    { token, method: 'DELETE' },
  );
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
  hasConfirmedTotp?: boolean;
  /** Audit entries + reviewed registrations. A permanent delete needs zero. */
  historyCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Every staff account with the history count that gates a permanent delete. */
export function getStaff(tenant: string, token: string, signal?: AbortSignal) {
  return apiFetch<{ items: StaffSummary[] }>(tenant, '/staff', { token, signal });
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
  return apiFetch<{ id: string; totp?: { secret: string; keyUri: string } }>(tenant, '/staff', {
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
  filter: {
    actorId?: string;
    entityType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
  /** See `listCitizens`. */
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (filter.actorId) query.set('actorId', filter.actorId);
  if (filter.entityType) query.set('entityType', filter.entityType);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  query.set('limit', String(filter.limit ?? 50));
  query.set('offset', String(filter.offset ?? 0));

  return apiFetch<{ items: AuditEntry[]; total: number }>(tenant, `/audit?${query}`, {
    token,
    signal,
  });
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

// ─────────────────────────  Fees & payments  ─────────────────────────

export interface MunicipalitySettings {
  /** The municipality's public number, printed on receipts. */
  contactPhone: string | null;
  /**
   * The office WhatsApp account: printed on the receipt for the citizen to
   * reply to, and the account a clerk should be signed into before sending
   * one. It cannot make a `wa.me` link send *from* this number — see the
   * settings screen.
   */
  whatsappNumber: string | null;
  whishMoneyNumber: string | null;
  cashOfficeHours: string | null;
  cashOfficeAddress: string | null;

  // ── Municipality profile ──────────────────────────────────────────────
  nameAr: string | null;
  nameEn: string | null;
  contactEmail: string | null;
  website: string | null;
  governorate: string | null;
  district: string | null;
  town: string | null;
  /**
   * Absent — not null — for a citizen.
   *
   * The crest is a data URI in the hundreds of kilobytes, and this endpoint is
   * read by everyone opening the pay dialog, so the server sends it to staff
   * only. The key being missing rather than null is deliberate: a client can
   * tell "not sent to you" from "no logo configured".
   */
  logoDataUri?: string | null;

  // ── Finance defaults ──────────────────────────────────────────────────
  defaultFeeFrequency: FeeFrequency;
  defaultDueDays: number;
  priceDisplay: 'compact' | 'exact';
  /** Percent. Display only — anything charging money must read the server's
   *  Decimal rather than this JSON number. */
  defaultRatePercent: number;
  baseCurrency: CurrencyCode;
  secondaryCurrency: CurrencyCode | null;
  exchangeRate: number | null;
  /** Stamped server-side, and only when the rate actually changes. */
  exchangeRateUpdatedAt: string | null;

  numberingSequences: Record<SequenceKey, NumberingSequence> | null;
  backupSchedule: BackupSchedule | null;

  updatedAt: string | null;
}

/** How long a settings read is reused. It changes a few times a year. */
const SETTINGS_TTL_MS = 60_000;

/**
 * Readable by any signed-in user — the portal prints these on the pay modal.
 *
 * De-duplicated and briefly cached, because six unrelated screens read it: the
 * fees ledger, the payments log, every citizen profile, the citizen pay dialog
 * and each settings tab as it opens. Concurrent callers share one request.
 *
 * `includeLogo` is opt-in and off by default. The crest is a data URI in the
 * hundreds of kilobytes, and every one of those screens except the settings
 * form wants a phone number and some opening hours — they were all downloading
 * it and using none of it.
 */
export function getMunicipalitySettings(
  tenant: string,
  token: string,
  options: { includeLogo?: boolean } = {},
) {
  const includeLogo = options.includeLogo === true;
  // The token is deliberately not part of the key — see `cachedRequest`.
  return cachedRequest(
    `settings:${tenant}:${includeLogo ? 'full' : 'lite'}`,
    SETTINGS_TTL_MS,
    () =>
      apiFetch<MunicipalitySettings>(
        tenant,
        `/fees/settings${includeLogo ? '?includeLogo=true' : ''}`,
        { token },
      ),
  );
}

/**
 * SUPER_ADMIN only, server-enforced.
 *
 * Every field is optional and only what is sent is written — which is what
 * lets one section of the settings screen save without clearing the fields
 * owned by the five it did not render. An empty string clears a text field; a
 * missing key leaves it alone. The two are not the same and the server does
 * not treat them as such.
 */
export async function updateMunicipalitySettings(
  tenant: string,
  token: string,
  input: Partial<{
    contactPhone: string;
    whatsappNumber: string;
    whishMoneyNumber: string;
    cashOfficeHours: string;
    cashOfficeAddress: string;

    nameAr: string;
    nameEn: string;
    contactEmail: string;
    website: string;
    governorate: string;
    district: string;
    town: string;
    logoDataUri: string;

    defaultFeeFrequency: FeeFrequency;
    defaultDueDays: number;
    priceDisplay: 'compact' | 'exact';
    defaultRatePercent: number;
    baseCurrency: CurrencyCode;
    /** `null` clears it. Omitting leaves whatever is stored. */
    secondaryCurrency: CurrencyCode | null;
    exchangeRate: number | null;

    numberingSequences: Record<SequenceKey, NumberingSequence>;
    backupSchedule: BackupSchedule;
  }>,
) {
  const result = await apiFetch<MunicipalitySettings>(tenant, '/fees/settings', {
    token,
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  // Both variants, before the caller sees the response. A clerk who saves and
  // is then shown the value they replaced — because another tab reads the
  // cached copy a moment later — reasonably concludes the save failed.
  invalidateRequests(`settings:${tenant}:`);
  return result;
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
export async function issueFeeNotice(
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
  const result = await apiFetch<{ noticeId: string; issued: number }>(tenant, '/fees/notices', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
  invalidateRequests(`fee-summary:${tenant}`);
  return result;
}

export interface FeeSummary {
  unpaidTotal: number;
  unpaidCount: number;
  pendingReviewCount: number;
  paidTotal: number;
  paidCount: number;
}

export function getFeeSummary(tenant: string, token: string) {
  return cachedRequest(`fee-summary:${tenant}`, 30 * 1000, () =>
    apiFetch<FeeSummary>(tenant, '/fees/summary', { token }),
  );
}

export interface PendingPayment {
  id: string;
  title: string;
  amount: number;
  currency: string;
  dueDate: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  isSeen?: boolean;
  citizenId: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenReference: string | null;
}

/** The clerk's queue: money claimed but not yet confirmed. */
export function getPendingPayments(tenant: string, token: string, unseenOnly?: boolean) {
  const query = unseenOnly ? '?unseenOnly=true' : '';
  return apiFetch<{ items: PendingPayment[] }>(tenant, `/fees/payments/pending${query}`, { token });
}

/** Mark a pending payment notification as seen. */
export function markPaymentAsSeen(tenant: string, token: string, id: string) {
  return apiFetch<{ id: string; isSeen: boolean }>(
    tenant,
    `/fees/payments/${encodeURIComponent(id)}/seen`,
    { token, method: 'PATCH' },
  );
}

/** Mark all pending payment notifications as seen. */
export function markAllPendingPaymentsAsSeen(tenant: string, token: string) {
  return apiFetch<{ updatedCount: number }>(
    tenant,
    '/fees/payments/pending/mark-all-seen',
    { token, method: 'POST' },
  );
}

export async function reviewPayment(
  tenant: string,
  token: string,
  id: string,
  input: { confirmed: boolean; note?: string },
) {
  const result = await apiFetch<{ paymentStatus: string }>(
    tenant,
    `/fees/payments/${encodeURIComponent(id)}/review`,
    { token, method: 'PATCH', body: JSON.stringify(input) },
  );
  invalidateRequests(`fee-summary:${tenant}`);
  return result;
}

export interface CitizenPaymentItem {
  id: string;
  title: string;
  amount: number;
  paidAmount: number;
  remaining: number;
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

/**
 * Opens a Whish checkout for one of the signed-in citizen's own bills.
 *
 * `redirectUrl` is where the browser goes next — the provider's hosted page
 * once credentials are configured, and back to the portal until then.
 * `pending` says which of those happened, so the UI can tell the citizen the
 * truth rather than claiming a payment that has not been taken.
 */
export function startWhishCheckout(tenant: string, token: string, paymentId: string) {
  return apiFetch<{ redirectUrl: string; pending: boolean }>(
    tenant,
    `/fees/payments/mine/${encodeURIComponent(paymentId)}/whish/checkout`,
    { token, method: 'POST' },
  );
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

/**
 * Citizen sign-in by رقم مرجعي alone — the landing page's single field.
 *
 * A separate function against a separate route, not `loginByReference` with an
 * omitted phone: the payments portal still requires both, and the two bars are
 * meant to stay visibly different at every layer. See `referenceOnlyLoginSchema`
 * for what the municipality is accepting by using this one.
 */
export function openByReference(tenant: string, referenceNumber: string) {
  return apiFetch<Session>(tenant, '/auth/citizen/reference/open', {
    method: 'POST',
    body: JSON.stringify({ referenceNumber }),
  });
}

/** One invoice as the admin ledger shows it — who owes it, and where it stands. */
export interface AdminPaymentItem {
  id: string;
  title: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  currency: string;
  dueDate: string;
  paymentStatus: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  paidAt: string | null;
  /**
   * Last write to the row. Stands in for the payment time on a *partial*
   * settlement, which never gets a `paidAt` — see the note on the server.
   */
  updatedAt: string;
  /** The محصّل holding the money — set only on a COLLECTOR payment. */
  collectedByName: string | null;
  frequency: string | null;
  citizenId: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenReference: string | null;
}

/**
 * Every invoice, filterable by status, method and by who owes it.
 *
 * `transactionsOnly` narrows it to rows where money moved (or is claimed to
 * have) and re-orders newest-first — the سجل العمليات view, as against the
 * fees ledger's "what is owed".
 */
export function getAllPayments(
  tenant: string,
  token: string,
  filter: {
    status?: string;
    search?: string;
    citizenId?: string;
    method?: string;
    transactionsOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
  /** See `listCitizens`. */
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (filter.status) query.set('status', filter.status);
  if (filter.search) query.set('search', filter.search);
  if (filter.citizenId) query.set('citizenId', filter.citizenId);
  if (filter.method) query.set('method', filter.method);
  if (filter.transactionsOnly) query.set('transactionsOnly', 'true');
  if (filter.limit !== undefined) query.set('limit', String(filter.limit));
  if (filter.offset !== undefined) query.set('offset', String(filter.offset));
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch<{
    items: AdminPaymentItem[];
    total: number;
    /** Computed over every matching row, not the returned page. */
    totals: {
      collected: number;
      cash: number;
      whish: number;
      collector: number;
      awaiting: number;
    };
  }>(tenant, `/fees/payments${suffix}`, { token, signal });
}

/**
 * One invoice, loaded directly by id.
 *
 * What تسجيل دفعة reads when it is its own page rather than a dialog opened
 * from an already-loaded row: a refresh, a bookmark, or a link from a receipt
 * arrives with nothing but this id.
 */
export function getPaymentById(tenant: string, token: string, id: string) {
  return apiFetch<AdminPaymentItem>(tenant, `/fees/payments/${encodeURIComponent(id)}`, {
    token,
  });
}

/** A one-off charge against a single citizen — no notice, no recurrence. */
export async function chargeCitizen(
  tenant: string,
  token: string,
  input: { citizenId: string; title: string; amount: number; dueDate: string },
) {
  const result = await apiFetch<{ id: string }>(tenant, '/fees/payments', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
  invalidateRequests(`fee-summary:${tenant}`);
  return result;
}

/**
 * Records money handed over in person. Goes straight to PAID — the clerk
 * confirming it is the clerk who took it.
 */
export async function settlePayment(
  tenant: string,
  token: string,
  id: string,
  input: {
    method?: string;
    amount?: number;
    /** Required by the server when `method` is `WHISH_MONEY`. */
    whishTransactionRef?: string;
    /** Required by the server when `method` is `COLLECTOR`. */
    collectedById?: string;
    note?: string;
  } = {},
) {
  const result = await apiFetch<{ paymentStatus: string }>(
    tenant,
    `/fees/payments/${encodeURIComponent(id)}/settle`,
    // The `CASH` default is kept ahead of the spread so an omitted method
    // still means cash, as it did before the counter could bank a transfer.
    { token, method: 'PATCH', body: JSON.stringify({ method: 'CASH', ...input }) },
  );
  invalidateRequests(`fee-summary:${tenant}`);
  return result;
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

// ─────────────────────────  Backup and restore  ─────────────────────────

export interface SnapshotManifest {
  version: number;
  tenantSlug: string;
  createdAt: string;
  migrations: string[];
  counts: Record<string, number>;
}

export interface RestoreReport {
  dryRun: boolean;
  manifest: SnapshotManifest;
  deleted: Record<string, number>;
  written: Record<string, number>;
}

/**
 * Downloads the restorable snapshot — real table rows, gzipped JSON.
 *
 * Not `apiFetch`, which parses every response as JSON: this one is a binary
 * file the municipality keeps on disk. SUPER_ADMIN only, server-enforced.
 */
export async function exportSnapshot(tenant: string, token: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/t/${encodeURIComponent(tenant)}/backup/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      code: 'UNKNOWN',
      message: 'تعذّر إنشاء النسخة الاحتياطية.',
    }))) as ApiError;
    throw new ApiRequestError(response.status, payload);
  }
  return response.blob();
}

/**
 * Puts a snapshot back.
 *
 * `dryRun` defaults to true here as well as on the server. Two defaults for one
 * decision is deliberate: this is the call that replaces a municipality's
 * register, and a caller that forgets the flag should rehearse, not destroy.
 */
export async function restoreSnapshot(
  tenant: string,
  token: string,
  snapshot: Blob,
  options: { confirmTenantSlug: string; dryRun?: boolean },
): Promise<RestoreReport> {
  const query = new URLSearchParams({
    confirm: options.confirmTenantSlug,
    dryRun: String(options.dryRun !== false),
  });
  const response = await fetch(
    `${API_URL}/t/${encodeURIComponent(tenant)}/backup/restore?${query}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // Anything but application/json, so no body parser consumes the stream
        // before the controller reads it.
        'Content-Type': 'application/gzip',
      },
      body: snapshot,
    },
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      (payload as ApiError) ?? { code: 'UNKNOWN', message: 'تعذّرت الاستعادة.' },
    );
  }
  return payload as RestoreReport;
}

export async function changeStaffPassword(
  tenant: string,
  token: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ changed: boolean }> {
  return apiFetch<{ changed: boolean }>(tenant, '/auth/staff/change-password', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export async function changeStaffEmail(
  tenant: string,
  token: string,
  input: { newEmail: string; currentPassword: string },
): Promise<{ email: string }> {
  return apiFetch<{ email: string }>(tenant, '/auth/staff/change-email', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export async function sendStaffPasswordResetEmail(
  tenant: string,
  token: string,
  redirectTo?: string,
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(tenant, '/auth/staff/send-reset-password-email', {
    method: 'POST',
    token,
    body: JSON.stringify({ redirectTo }),
  });
}

export async function beginStaffTotpEnrolment(
  tenant: string,
  token: string,
): Promise<{ secret: string; keyUri: string }> {
  return apiFetch<{ secret: string; keyUri: string }>(tenant, '/auth/staff/totp/enrol', {
    method: 'POST',
    token,
  });
}

export async function confirmStaffTotpEnrolment(
  tenant: string,
  token: string,
  input: { token: string },
): Promise<{ confirmed: boolean }> {
  return apiFetch<{ confirmed: boolean }>(tenant, '/auth/staff/totp/confirm', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export async function disableStaffTotp(
  tenant: string,
  token: string,
  input: { currentPassword?: string },
): Promise<{ disabled: boolean }> {
  return apiFetch<{ disabled: boolean }>(tenant, '/auth/staff/totp/disable', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

