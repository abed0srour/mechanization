# Open decisions

Things this codebase cannot decide for itself. Each one is flagged in the
architecture spec; this file is where they are tracked to a resolution, with
what the code currently does in the meantime.

**Four of these block handling real citizen data.** They are marked 🔴. The
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

---

## 9. Who is accountable for a «يتطلب مراجعة» record, and by when

**Status:** unanswered. Owner: the municipality, not engineering.

A field officer may now register a citizen with named fields left
«غير مؤكَّد / بانتظار المعلومة», each with a written reason. That was the only
honest alternative to the two things the form used to force: invent a value, or
do not register the person. What it does not decide is what happens next.

Needed from the municipality:

- **Who owns the queue.** A record filed with three unestablished fields sits in
  «يتطلب مراجعة» until someone opens it and fills them in. Nothing currently
  assigns that to a person or a desk, so on present behaviour it is whoever
  notices.
- **How long is too long.** There is no deadline, no escalation and no reminder.
  A parcel number missing for a week is a normal afternoon's work; missing for a
  year is a register that has quietly stopped being accurate about that
  household — and the two look identical on screen today.
- **Whether an incomplete record may be billed.** It is billable now: the
  citizen is registered from the moment the row exists, and the fee engine does
  not read this status. That is deliberate — a household should not escape
  رسوم because a clerk could not reach their landlord — but a fee notice for a
  property with no رقم العقار is a document somebody has to be able to defend.
- **What may never be flagged.** The code fixes a minimum
  (`NON_FLAGGABLE_FIELDS`: the name, the nationality question, and the two
  property discriminators) on structural grounds — a record with no name cannot
  be found again, and the rest of the form branches on the others. Whether the
  municipality wants the identity document on that list too is a policy call
  this codebase should not make on its own.

**Current behaviour:** flagged records are stored, billable, searchable, and
counted on the registry's «يتطلب مراجعة» filter with the number of fields still
open. Each flag keeps the officer's reason verbatim, and filling a field in is
what clears it — there is no separate "resolve" action to forget to perform.
Nothing expires, nothing escalates, and nobody is notified.
