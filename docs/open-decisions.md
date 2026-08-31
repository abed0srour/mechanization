# Open decisions

Things this codebase cannot decide for itself. Each one is flagged in the
architecture spec; this file is where they are tracked to a resolution, with
what the code currently does in the meantime.

**Five of these block handling real citizen data.** They are marked 🔴. The
system is buildable and demoable without them; it should not collect a real
person's national ID number until they are answered.

---

## 🔴 1. Legal basis and retention policy for the data collected

**Status:** unanswered. Owner: whoever is accountable for the municipality's
data handling — not an engineering decision.

This system stores, per citizen: full name, national ID or passport number,
civil record number, residency number, phone, family size, home address and
coordinates, scanned identity documents, and **refugee / displaced status**.
That last field, combined with an address, is the kind of record that causes
concrete harm to a real person if it leaks or is handed to the wrong party.

Needed before real data is collected:

- A stated legal basis for holding it, and for holding residency status
  specifically.
- A retention period, and what happens at the end of it. Right now nothing is
  ever deleted — there is no retention job, because inventing a deletion policy
  in code would be worse than the absence of one.
- Who inside the municipality may see what. `AUDITOR` and `FIELD_INSPECTOR`
  exist as roles but the split between them was chosen by this codebase, not by
  the municipality.
- What a citizen may request: correction, export, deletion. None of these
  currently have an endpoint.

**Current behaviour:** all data is retained indefinitely. Audit entries redact
identity numbers (`AuditLogEntry.redact`), so the audit trail is not a second
copy of the sensitive fields, but the primary tables hold everything.

---

## 🔴 2. OTP delivery fallback

**Status:** structurally implemented, no provider chosen.

SMS delivery to Lebanese networks fails or stalls often enough that a single
provider makes citizen login a coin flip — and a citizen who never receives a
code has no other way in. The v1 spec had no answer here at all.

**What is built:**

- Two delivery routes (`SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_FALLBACK_API_KEY`).
  From the second resend, `OtpService` switches to the fallback route rather
  than retrying the one that just failed.
- A visible resend path with a 30s cooldown, showing the citizen that waiting is
  expected.
- Production boot **fails** without both keys set (`env.schema.ts`). Setting
  them equal is an explicit way to accept the single-provider risk.
- The login page tells a citizen who cannot receive a code to visit the
  municipality with their رقم مرجعي.

**What is not built:** `SmsProviderService.deliver()` throws — the actual HTTP
call cannot be written before a provider is chosen. Everything around it
(channel selection, failover, masking phone numbers in logs) is real.

**Still to decide:** which two providers, and whether a staff-assisted
registration path is needed for citizens who cannot complete OTP at all. The
counter fallback above is a workaround, not a feature.

---

## 🔴 3. Production hosting and data residency

**Status:** unanswered. Blocks launch, not development.

Candidates named in the spec: Railway, Fly.io, a VM. The deciding factor is not
price — it is whether this data may sit outside Lebanon, which is question 1's
territory.

Also unresolved by hosting choice:

- **Supabase region.** The example `DATABASE_URL` points at `ap-south-1`
  (Mumbai). That is almost certainly wrong for Lebanese citizen data and should
  be a deliberate decision, not a leftover from whichever region was clicked
  first.
- **Backups**: who takes them, where they live, and whether they inherit the
  same residency constraint. A backup in another jurisdiction is still data in
  another jurisdiction.

---

## 🔴 4. Duplicate-person tolerance

**Status:** partially decided in code; the product question is open.

v1 flagged `@@unique([phone, lastName])` as "a disambiguation aid, not a hard
identity gate". This codebase changed the key to
`@@unique([identityDocType, identityDocNumber])`, which is stricter and more
honest: a household shares a phone, so a phone was never an identity.

**What that still does not solve:** the same person can register twice under
different document types — once with a national ID, once with a passport — and
the system will see two people. Tightening further means rejecting legitimate
registrations from people whose documents genuinely differ.

**The product question:** which error is worse here — a duplicate claim, or a
displaced person turned away at the form because their paperwork does not match
what the municipality has on file? That is a policy call about fraud tolerance
versus access, and it should be made by the municipality rather than defaulted
in a schema.

---

## 🔴 4b. Field-visit notes, location capture, and escalation

**Status:** unanswered. Raised by the field-work feature (migration 0019).
Owner: the municipality, not engineering.

Door-to-door collection introduced three questions the code deliberately
answers as conservatively as it can while leaving the real decision open.

**Visit notes.** `field_visits.note` is a record *about a person*, written by a
stranger standing at their door, with no declaration behind it — the one place
in this system where that is true. `Registration` at least rests on an الإقرار
the citizen made; a note saying "رفض التعاون" rests on nothing. What is built:
capped at 500 characters, required only where a parcel is being closed or
someone is being recorded as refusing, and the field itself tells the worker on
screen that it is for the visit and not for the household.

- **Needed:** a retention period *shorter* than the register's. A note about a
  refusal in 2026 should not still be readable in 2036. There is no retention
  job (question 1), so today these live forever, which is the wrong answer.
- **Needed:** whether a citizen may see the notes written about their own
  address, and whether those notes belong in a CSV export at all. They are
  currently excluded from every export by omission rather than by rule.

**Location capture.** `field_visits.latitude/longitude` is nullable, the UI
requests it only when the worker taps for it, and `captureLocation` is hardcoded
`false` on the field screen. That is a placeholder for a decision, not a
setting: stamping coordinates on every visit is the obvious defence against a
worker marking doors "not home" from a café, and it is also surveillance of
municipal employees. It needs the municipality's decision, taken openly with the
staff it affects, before the flag is turned on — and if it is turned on, those
staff should be told, not discover it.

**Escalation.** `REFUSED` maps to `WAITING`, not `CLOSED`, on the reasoning that
a refusal is where a case stops being field work and becomes the municipality's.
But nothing decides *what* the municipality then does, or after how many
attempts. `FollowUpItem.attempts` is surfaced on the coverage screen precisely
so this policy has something to hang on when it exists.

**Current behaviour:** notes retained indefinitely and excluded from exports;
location capture off; no escalation rule — a refused parcel simply stays in the
follow-up queue with its attempt count rising.

---

## 5. Horizontal scaling → rate limiting

**Status:** decided, with a documented trigger.

`@nestjs/throttler` uses in-memory storage. This is correct for one instance and
wrong the moment there are two: per-instance counters make the effective limit
N× what is configured, so staff login would allow 5×N attempts per minute.

**Trigger to revisit:** the first time a second backend replica is deployed.
That is the one piece Redis needs to come back for; nothing else in v2 depends
on it.

---

## 6. Tenant count → migration strategy

**Status:** decided, with a documented trigger.

Schema-per-tenant means every migration runs once per municipality
(`pnpm tenant:migrate-all`). At tens of tenants this is a loop and a non-issue.

**Trigger to revisit:** low hundreds of tenants, or a migration that takes long
enough that the loop becomes a deployment window problem. Not before — the
isolation guarantee is worth this cost at the expected scale.

---

## 7. Wizard field spec

**Status:** derived, needs confirmation.

The architecture doc references a companion `wizard-architecture-spec.md` as the
field and validation source of truth for the 7-step wizard. That document was
not available. The wizard was instead derived from:

- the Zod schemas in `packages/shared-schemas` (which already encoded the
  occupancy and property-type conditional axes as discriminated unions), and
- the `Albazourieh` reference implementation's `CitizenWizardForm.tsx`.

**Assumptions made, worth checking against the real spec:**

- Step order: personal → contact → properties → locations → documents → review →
  declaration. Properties span steps 3–4, matching the "Steps 3–4" comment in
  `property.schema.ts`.
- `صفة الإقامة` describes the person, never the property, and only *suggests* a
  property type (`SUGGESTED_PROPERTY_TYPE`) — it never gates one.
- Required proof follows occupancy: `RENTAL_CONTRACT` for a tenant,
  `OWNERSHIP_PROOF` for an owner.
- Location is optional on every property.

---

## 8. Credential rotation

**Status:** action required now.

The project brief contained what appear to be live credentials in plain text: a
Supabase database password and a JWT secret. Anything pasted into a chat, a
ticket, or a shared document must be treated as disclosed.

**Rotate before any real use:** the Supabase database password, the service-role
key, and `JWT_SECRET`. Rotating `JWT_SECRET` invalidates all existing sessions,
which is harmless now and disruptive later — so do it now.

No real secret is committed to this repository; `apps/backend/.env.example`
contains placeholders only.
