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
- ~~Production boot **fails** without both keys set (`env.schema.ts`).~~
  **Removed 2026-09-05.** The check demanded credentials for a route that
  cannot carry a message — `deliver()` throws with both keys set exactly as it
  does with neither — so all it enforced was a boot failure. Production now
  starts without them and `SmsProviderService` logs an error at boot instead.
  Restore the check in the same change that implements `deliver()`; at that
  point the keys mean something again.
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
  `OWNERSHIP_PROOF` for an owner, and **nothing for a شاغل بتسامح** — no بدل is
  paid so there is no عقد إيجار, and the سند الملكية names the owner, who is
  not the person filing. `requiredProofDocument` returns null for that case
  rather than demanding a paper that does not exist. Worth confirming with the
  municipality that a card with no attachment is acceptable there.
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

---

## 🔴 10. A رقم العقار the cadastre has never heard of

**Status:** the code has stopped refusing these. Whether that is where the line
belongs is the municipality's call.

Until now a property number absent from the imported cadastre was rejected
outright, on the reasoning that it could only be a typo. That reasoning held at
a counter and broke completely in the field: a record filed with no signal is
validated in the browser, queued, and promised to the officer as sent — and
then refused hours later on sync, in a settlement nobody is going back to, over
a number the officer read off the deed in front of them. The register was
losing whole households to a check meant to catch a mistyped digit.

The number is now kept as read. The record is stored, the parcel is annotated
«بانتظار التحقق» with the reason attached, and the whole record lands in the
same «يتطلب مراجعة» queue as any other open question. Nothing is guessed at and
nothing is discarded; the typo is caught by the person who was always going to
have to catch it, with the household's data in front of them instead of a
blank. The annotation is re-derived on every save, so a record held only because
its parcel was missing clears itself the first time anyone saves it after the
survey office imports that parcel.

Needed from the municipality:

- **Whether an unverified parcel may be billed.** Same question as §9 and the
  same current answer — yes, it is billable from the moment the row exists —
  but sharper here, because the fee notice would carry a رقم العقار the
  municipality's own registry does not contain. That is a document somebody has
  to be able to defend at a counter.
- **How stale a cadastre is allowed to get.** This change moves the cost of an
  out-of-date cadastre from the officer (whose record was refused) to the
  reviewer (whose queue now grows). That is the right direction, and it stops
  being right if the survey office's export is a year behind and the queue is
  mostly parcels that do exist.
- **Whether a bulk import should behave the same way.** It now does: a
  spreadsheet row with an unknown parcel used to fail the row and is now
  imported as «يتطلب مراجعة». For a municipality's existing paper register —
  the case imports exist for — keeping the data and flagging it is almost
  certainly right, but it is a change in what a clerk sees after an upload.

**Current behaviour:** submission and edit both report rather than refuse. A
municipality with no cadastre imported is unaffected — there is nothing to
check against, so nothing is annotated. Only the server may raise this
annotation; one sent by a browser is discarded and recomputed, so a phone that
queued a record days ago cannot replay a verdict the cadastre has since
outgrown.

---

## 🔴 11. Whether a fee is charged per citizen or per unit

**Status:** the code can now do either. Which one applies, and to which fees, is
a council decision with a legal basis behind it — not a deploy.

The register could always record that a citizen holds six shops. The biller
could not read it. A notice's `amount` *was* the invoice, and the only question
ever asked of a citizen's holdings was a boolean — do they have at least one of
these — so six shops and one shop were billed identically. That was never a
policy anyone chose; it was the shape of the code.

A notice now carries a **basis**. `FLAT` is the old behaviour and the default,
so every notice already issued keeps charging exactly what it charged, and this
change alters nobody's bill until someone deliberately issues a notice on one of
the other two: `PER_UNIT` (rate × units held) or `PER_AREA` (rate × total m²).
Each invoice stores the breakdown it was computed from, so the number can be
defended at the counter against the register as it stood the day the bill was
raised.

Needed from the municipality:

- **Which fees move, and on what authority.** Moving رسم المحلات to `PER_UNIT`
  multiplies what some residents owe. That needs the by-law it rests on named
  before it is switched on, and residents told before the first notice lands.
- **A dry run first.** Before switching a live recurring notice, issue it once
  and read the assessment: the system reports who would be billed what. A
  municipality should see the distribution — especially the largest bills —
  before residents do.
- **What happens to unsurveyed buildings.** A مبنى whose units were never
  surveyed cannot be assessed per unit, and the code **refuses to guess**
  rather than counting it as zero: counted as zero, the largest building in the
  municipality would pay nothing, and the schedule of fees would be most
  generous to exactly the properties worth the most. Those citizens are named
  in the issue result and left unbilled. Somebody has to own chasing that
  survey, which is the same unanswered question as §9.
- **Whether area data is good enough to bill on.** `PER_AREA` is only as honest
  as the areas in the register. A unit with no recorded area is refused rather
  than defaulted, but a *wrong* area bills wrongly and looks fine.

**Current behaviour:** basis defaults to `FLAT` everywhere, including for every
existing notice. Recurring notices re-assess each period, so a citizen who
registers two more shops is billed for them next month and one who sells a
building stops paying for it. One invoice per citizen per period regardless of
basis — never one per unit — because the settlement, receipt, Whish and
collector flows all key on a single payment row, and a citizen at a counter
should get one bill that can explain itself rather than six that cannot.

---

## 🔴 12. Who bears each fee — الرسم على الشاغل أم على المالك

**Status:** the register can now say who occupies each unit, and each notice
says whether it falls on the occupant or the owner. Which of the two applies to
which fee is a council decision with a legal basis behind it — the same bar as
§11, for the same reason.

Lebanese practice has always distinguished الشاغل — the person occupying a
property, who owes the القيمة التأجيرية and رسم النظافة — from a شاغر unit,
which has no occupant and is conventionally relieved of those fees while
remaining liable for the foundational ones (أرصفة, مجاري). The register could
express neither: occupancy was OWNER or TENANT, so a شاغل بتسامح was filed as a
tenant, and a unit had no state at all, so a landlord's empty third floor and
his occupied second were identical rows.

Two columns now carry it. `PropertyEntry.unitStatus` (مشغولة من المالك / مؤجرة
/ شاغرة / قيد الإنجاز) records what each unit is, per unit; `FeeNotice.bearer`
records who owes the fee, per notice.

**The bearer is the question, and vacancy is one of its answers.** This started
as a boolean — "does this notice charge empty units?" — and that was a symptom
mistaken for the disease. It could not reach the other half of the same
problem: a مبنى is filed once by its owner and again, flat by flat, by each
tenant, so under a per-unit notice the same apartment was charged twice, to two
people. No municipality would choose that; it survived only because nothing
could tell an owner's own home from an owner's let flat. Both halves fall out
of one fact:

- **`OCCUPANT`** — رسم النظافة, القيمة التأجيرية. An owner pays for what they
  live in, a مستأجر and a شاغل بتسامح for what they occupy, a let flat is
  billed to its tenant alone, and an empty or unfinished unit to nobody.
- **`OWNER`** — الأرصفة, المجاري, and the rest of الرسوم التأسيسية. The deed
  holder pays for everything they own, occupied or not; tenants owe none of it.

There is deliberately no third value meaning "charge everyone holding it". That
was the old behaviour, and it is double taxation of one unit rather than a
policy anyone would adopt.

Needed from the municipality:

- **Which bearer each fee carries, and under which article.** This is now a
  required choice on every non-flat notice rather than a default someone can
  arrive at without meaning to, and it is the one decision that determines both
  who is billed and which units are exempt.
- **Whether قيد الإنجاز should be separable from شاغرة.** An occupant-borne fee
  exempts both, since nobody is in either. An owner-borne fee charges both,
  since both are owned. A council wanting to relieve construction from an
  owner-borne fee has no way to say so today; that would be a second flag, not
  a deep change.
- **Who re-checks a unit's status, and how often.** This is the sharp edge and
  it has no technical answer. A flat marked شاغرة in March and let in April
  keeps billing as exempt in December, because recurring notices re-assess
  against whatever the register currently says. Unlike an unsurveyed building —
  which refuses to be billed and names itself — a stale status looks like a
  complete record. Same unanswered question as §9, arriving on a field that
  costs money.

**Deliberate asymmetries, so they are not read as oversights:**

- **A unit nobody marked is charged.** Null means "not asked", never "empty".
  This is also what makes `OCCUPANT` safe as the default: on a register with no
  حالة الوحدة recorded anywhere, every unit reads as occupied by its owner, so
  the owner is billed for all of them and each tenant for their own — exactly
  the arithmetic that came before any of this existed. The double-charge
  corrects itself only as landlords actually mark units مؤجرة, which is the one
  mechanism that does not require guessing on their behalf.
- **The field is optional everywhere.** A required four-way choice on all twenty
  flats of a building is answered by thumb, not by looking — and a guessed
  exemption is worse than no exemption. The units editor offers a "set all"
  control instead, so the common case is one tap and the officer is left with
  the units that actually differ.
- **Only an owner is asked.** A مستأجر or a شاغل بتسامح *is* the occupant of
  what they are filing. `PropertyEntry.normalise` strips a status from any
  non-owner card, because a «شاغرة» left behind by an occupancy change would
  claim the filer does not live there — and could exempt them from a fee they
  owe.
- **Units left out are counted, not merely omitted.** Every invoice stores
  `excludedUnitCount` and the issue result reports the total. Revenue absent by
  design is still revenue absent, and it has to be a number somebody can take
  to the council rather than a difference nobody can see.
- **FLAT ignores the bearer entirely.** A flat notice never asks the register
  what anyone holds, so there is no unit for a bearer rule to include or
  exclude. The consequence is that "a flat annual charge on property owners"
  is not currently expressible; say so if it is wanted.

**Still not solved by any of this:** a vacant unit whose owner never registered
is invisible, because the register is keyed to citizens and a property card
only exists under one. This records the vacancies of people the municipality
already knows about; it is not a vacancy census.
