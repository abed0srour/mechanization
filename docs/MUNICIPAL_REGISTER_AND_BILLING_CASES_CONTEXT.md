# Municipal Citizen Register & Fee Engine — Comprehensive Context & Cases Guide

This document serves as the complete technical, operational, and domain context for the **Mechanization Register & Billing Core** in the Lebanese municipal platform (`mechanization-1`). 

It is structured so that any AI assistant (such as Claude), developer, or municipal auditor can understand the system's architecture, the recent audit findings, the required schema enhancements, and how real-world Lebanese municipal edge cases are resolved.

---

> ### ⚠️ Superseded in four places by what was actually built
>
> This document is the design *brief*. The implementation (migration `0025_households`,
> `application/common/record-linkage.ts`, `application/features/households/`) deliberately
> diverges from it on four points, and the divergences are load-bearing — implementing what
> this document says instead would reintroduce the defects they exist to avoid.
>
> 1. **No `headOfHouseholdId` on `User`.** A self-referencing FK can form cycles, cannot
>    describe two co-equal adults, and makes promoting a newly-arrived husband a rewrite of
>    every dependent row. Membership is `User.householdId → Household`; headship is one
>    nullable column *on* `Household`. This is also what makes merging two families a single
>    `updateMany`, and therefore reversible.
>
> 2. **«Same سجل» is not evidence of a couple.** Section 4, Case 3, Clue 2 reads a shared
>    civil registry as showing that two people are married. A سجل identifies a *patrilineal
>    family record* — a man, his father, his brothers, their wives and their children all
>    carry the same one — so it fires for every wrong pair in the family, and misses a
>    marriage the نفوس has not yet recorded. It is used as a **blocking key** to bound the
>    candidate search, and carries one of the smallest positive weights in the scorer.
>    `household — what a matching سجل is and is not` in `household-linkage.spec.ts` holds
>    that line. اسم الأم carries the heaviest weight instead: it is the only identity field
>    that crosses the patriline.
>
> 3. **The banner does not show the candidate household.** The mockup in Case 3 displays the
>    matched family's name and children to an arriving man before he has confirmed any
>    relationship to them — which discloses a household, minors included, to a stranger every
>    time the match is wrong. What is shown is that *a* candidate exists; the confirming
>    question is put to the citizen, and their رقم مرجعي is what answers it.
>
> 4. **Two outcomes became three, plus an ambiguity rule.** «Link / Ignore» is a coin toss
>    where two cousins share three names. The engine returns `LINK` / `REVIEW` / `NO_MATCH`,
>    and a winner within `margin` of the runner-up is downgraded to `REVIEW` however high it
>    scored — see `decide`.
>
> Also: `relationToHead` uses `CHILD`, not `SON`/`DAUGHTER` (gender is its own column, and
> the pair would let a row say `SON` and `FEMALE` at once), and `ownershipShares` is **not**
> yet implemented — it remains an open item from the audit.

---

## 1. System Architecture & Context

### Tech Stack & Monorepo Structure
* **Backend:** NestJS, Prisma ORM, PostgreSQL (`apps/backend`).
* **Frontend:** Next.js 15 (App Router), React 18, TailwindCSS, Radix UI primitives (`apps/frontend`).
* **Shared Schemas:** TypeScript monorepo package with Zod validation contracts (`packages/shared-schemas`).
* **Target Environment:** Lebanese municipalities (governed by Lebanese Municipalities Act and Municipal Fees Law No. 60/1988).

### Architectural Foundations That Are Solid
The financial and money-movement core of the platform is well-tested and robust:
1. **Append-Only Ledger:** Every payment, partial settlement, and reversal is logged as an opposing immutable row with PostgreSQL sequences for receipt numbers and database row-level locking (`SELECT ... FOR UPDATE`).
2. **Frozen Invoices:** Invoice amounts, titles, and assessment JSON breakdowns are denormalized and frozen at issuance time, ensuring retrospective rate or cadastre changes never alter historical debt.
3. **Idempotent Recurring Cycles:** Recurring billing runs use deterministic period keys (`@@unique([citizenId, feeNoticeId, periodKey])`), making cron execution safe against retries or server restarts.
4. **FeeBearer Matrix:** Resolves liability between `OWNER`, `TENANT`, and `OCCUPANT` (`FREE_OCCUPANT`), preventing double-charging across landlord and tenant for the same parcel.

---

## 2. The Core Problem Identified in the Audit

While the financial ledger is sound, the **register and citizen modeling** lacked representation for several standard Lebanese municipal realities:

1. **Inherited Property / Heirs (ورثة):** Land in Lebanon is legally divided into **2,400 shares** (*أسهم*). Parcels routinely have multiple co-heirs. Without a share field, each heir registering the property was billed for 100% of the parcel, resulting in multiplying taxes (e.g., 500% collection for 5 heirs).
2. **Divergence in Billing Targets (F-01 & F-02):** 
   * `resolveTargets()` matched citizens having *any* registration (`some`).
   * `assessTargets()` read *only the latest* registration (`orderBy submittedAt desc, take: 1`).
   * If a citizen filed a new property a year later through the registration form, their earlier properties vanished from the billing engine.
3. **Statutory Fee Mismatch (Law 60/88):**
   * The system supported: `FLAT`, `PER_UNIT`, and `PER_AREA`.
   * Lebanese Law 60/88 specifies a **percentage of assessed annual rental value** (*القيمة التأجيرية*): 5% for residential units, 7% for commercial units, plus an annual sewer/pavement maintenance fee (*رسم صيانة المجارير والأرصفة*).
4. **Population Double-Counting:**
   * Population was computed as `sum(familySize)`.
   * A husband and wife registering separately each declared their family size (e.g., 5 + 5), artificially inflating municipal demographics to 10.
5. **Lebanese Identity Ambiguity:**
   * Civil record numbers (*رقم السجل*) are **only unique within a specific village/quarter** (*محل القيد*). Every village in Lebanon has a *سجل 1*, *سجل 45*, etc.
   * Storing *رقم السجل* without *محل القيد* causes immediate collisions.
   * Without **Date of Birth** and **Mother's Name** (*اسم الأم*), clerks cannot distinguish between first cousins who share identical first, father, and family names.

---

## 3. The Eight Critical Data Model Additions

To align the platform with real-world municipal requirements before handling live citizen data, eight additions are introduced:

| Field | Location | Type | Why It Is Mandatory |
| :--- | :--- | :--- | :--- |
| **`householdMembers[]`** | New `HouseholdMember` entity | 1–N related rows | Replaces the blind integer count `familySize`. Stores Name, Relation, Birth Year, and Gender. Powering social aid, school planning, elderly assistance, and deduplicated census. |
| **`headOfHouseholdId`** | `User` / Citizen | `UUID, nullable` | Links secondary citizen accounts (e.g., wife or adult son) to the family unit, preventing duplicate household creation. |
| **`dateOfBirth`** | `User` / Citizen | `Date, nullable` | Standard on Lebanese national IDs; essential for distinguishing individuals with identical names. |
| **`registrationPlace`** | `User` / Citizen | `String (Town + District)` | Qualifies *رقم السجل*. In Lebanon, *سجل 45* is meaningless without specifying the village (e.g., *صور - دير قانون النهر*). |
| **`motherName`** | `User` / Citizen | `String, nullable` | Found on every *إخراج قيد*. Acts as the definitive legal tie-breaker between related citizens sharing the same family name. |
| **`altPhone` & `altPhoneRelation`** | `User` / Citizen | `String, nullable` | Ensures continuity of municipal contact (e.g., son's mobile) if the primary household phone number changes. |
| **`email`** | `User` / Citizen | `String, nullable` | Optional channel for notifications, survives physical phone/SIM changes. |
| **Widen `lebanesePhone` Regex** | `primitives.ts` | Regex validation | Currently accepts only Lebanese mobiles (`03, 70, 71...`). Must be expanded to accept Lebanese landlines (`01, 04, 05, 06, 07, 08, 09`) and international E.164 formats (`+971...`, `+1...`) for expatriate landlords. |
| **`ownershipShare` (Bonus / Essential)** | `PropertyEntry` | `Int` (e.g., 480 out of 2400) | Represents the legal ownership share in *أسهم*, ensuring co-heirs are billed proportionally. |

---

## 4. Detailed Real-World Scenarios & Workflows

### Case 1: Inherited Land Held by Multiple Heirs (Co-ownership in 2400 Shares)
* **The Situation:** 
  A father passes away, leaving Parcel #120 to 5 children.
* **The Problem:** 
  All 5 children file a property card for Parcel #120 with `occupancyType: OWNER`. Under `PER_AREA` or `PER_UNIT`, the billing engine bills each child for 100% of the tax, generating 500% of the fee.
* **The Solution:**
  * In `PropertyEntry`, add an `ownershipShares` field (defaults to 2,400 for a sole owner).
  * Child A enters: Parcel 120, Owner, Shares = `480 / 2400` (20%).
  * Child B enters: Parcel 120, Owner, Shares = `480 / 2400` (20%).
  * **Fee Calculation:** The assessment formula multiplies the base fee by `(ownershipShares / 2400)`. Each child receives an invoice for their legal 20% fraction.

---

### Case 2: Family Member Property (Son Living in Father's Building)
* **The Situation:** 
  A father owns a 3-story building. His married son lives in Unit 2 without paying rent.
* **The Solution:**
  * When the **son** registers his home, he selects:
    * `occupancyType`: **`FREE_OCCUPANT` (*شاغل بتسامح*)**.
    * `landlordName`: He enters his father's name (e.g., *"Hassan Ali Khalil"*).
    * `landlordPhone`: Optional.
  * **Legal Billing Split (Law 60/88):**
    * Municipal service / sanitation fee (*رسم النظافة والإشغال*): Assigned to `FeeBearer.OCCUPANT` $\rightarrow$ Invoiced to the **son**.
    * Property / sewer / sidewalk maintenance fee (*رسم صيانة المجارير والأرصفة*): Assigned to `FeeBearer.OWNER` $\rightarrow$ Invoiced to the **father**.
  * No fictitious lease agreement or rental contract is required.

---

### Case 3: Registration Ordering — Wife Arrives First, Husband Arrives Later
In practice, field officers and municipal clerks cannot enforce who registers first.

#### Step A: Wife Arrives First
1. The wife (*Fatima Ahmad Harb*) visits the municipality to register a retail shop she owns.
2. She fills out Step 1 (Personal Details) with her own national ID, Date of Birth, Mother's Name, and *محل القيد*.
3. In Step 2 (Household), she marks herself as **"Primary Registrant for Household"**.
4. In the **Household Members Table**, she adds:
   * Husband: *Ali Hassan Khalil* (Birth Year: 1980)
   * Son: *Hussein* (Birth Year: 2010)
   * Daughter: *Nour* (Birth Year: 2014)
5. In Step 3 (Properties), she registers her **Shop** as sole owner (2400/2400 shares).
6. **Result:** Fatima's file is saved. Her shop is billed to her. The town census records a single household of 4 people.

#### Step B: Husband Arrives Weeks Later
1. The husband (*Ali Hassan Khalil*) visits the municipality to register the family residence (Apartment).
2. As the clerk enters Ali's name, *محل القيد* (e.g., *سجل 45 - صور*), or phone number, the system executes an automated match check.
3. **The 3-Clue Detection Mechanism:**
   * **Clue 1 (Household Roster Match):** An unlinked member named *"Ali Hassan Khalil"* (Birth Year: 1980, relation: Husband) exists in Fatima Harb's household.
   * **Clue 2 (Civil Registry Match):** Under Lebanese civil law, a married woman's official civil registry moves to her husband's record. Fatima and Ali share the exact same *سجل* and village (*سجل 45 - صور*).
   * **Clue 3 (Alternative Contact / Address):** Fatima listed Ali's phone number as the alternative household contact.
4. **On-Screen Suggestion Banner for the Clerk:**
   ```text
   ┌────────────────────────────────────────────────────────────────────────┐
   │ 💡 Family Match Found                                                  │
   │                                                                        │
   │ Ali Hassan Khalil is listed as HUSBAND in an existing household:       │
   │ • Registered by: Fatima Ahmad Harb (Wife)                              │
   │ • Civil Registry: Sijill 45 · Tyre                                     │
   │ • Registered Children: Hussein (14), Nour (10)                         │
   │                                                                        │
   │ [ ✔ Link to this Family ]             [ ✕ Ignore / Different Person ]  │
   └────────────────────────────────────────────────────────────────────────┘
   ```
5. **Action:** The clerk confirms with Ali (*"Are you married to Fatima Harb?"*) and clicks **"Link to this Family"**:
   * Ali is set as `Head of Household` (or linked co-head).
   * The existing children are linked to him without re-typing.
   * Ali registers his apartment. The apartment fee is billed to Ali; the shop fee remains billed to Fatima.
   * The town's total population remains strictly at **4 people**, avoiding double-counting.

---

### Case 4: Registration Ordering — Son Arrives Before Father
1. The son registers his apartment as `FREE_OCCUPANT` (*شاغل بتسامح*), writing his father's name as owner.
2. Weeks later, the father registers Parcel #150 (3-story building).
3. The system allows linking Unit 2 of the father's building to the son's existing registration, or matching by parcel number.
4. At any time, a clerk can use the **"Link to Household"** action on the citizen profile to manually link or reassign family trees.

---

### Case 5: Disambiguating Two Citizens with the Same Name
* **The Situation:** 
  Two cousins in the village are both named *Mohammad Ali Khalil*.
* **Resolution via the New Identity Fields:**
  * **Citizen A:** Born: 14/03/1976 | Mother: *Mariam Awada* | Registry: *Sijill 12 · Deir Qanoun*.
  * **Citizen B:** Born: 22/09/1991 | Mother: *Zainab Bazzi* | Registry: *Sijill 88 · Bint Jbeil*.
* **Result:** Zero chance of merging files, assigning wrong property debts, or overwriting records.

---

### Case 6: Expatriate Landlords & Landline-Only Households
* **The Situation:** 
  * Tenant registers a flat owned by an emigrant landlord living in the United Arab Emirates or USA.
  * An elderly resident only has an Ogero landline (*07-740123*).
* **The Solution:** 
  The phone validation schema (`primitives.ts`) accepts:
  * Lebanese Mobiles: `+961 3...`, `70...`, `71...`, `76...`, `78...`, `79...`, `81...`
  * Lebanese Landlines: `01...` through `09...`
  * International E.164 numbers: `+1...`, `+971...`, `+33...`, etc.

---

## 5. Technical Implementation Roadmap for Engineers

### 1. Database Migrations (`schema.prisma`)
1. **Extend `User` Model:**
   * `dateOfBirth DateTime? @db.Date`
   * `motherName String?`
   * `registrationPlaceTown String?`
   * `registrationPlaceDistrict String?`
   * `headOfHouseholdId String? @db.Uuid`
   * `altPhone String?`
   * `altPhoneRelation String?`
   * Add self-referencing relation for `headOfHousehold` / `dependents`.
2. **Create `HouseholdMember` Model:**
   * `id String @id @default(uuid())`
   * `citizenId String` (FK to `User`)
   * `fullName String`
   * `relation HouseholdRelation` (`SPOUSE`, `SON`, `DAUGHTER`, `PARENT`, `SIBLING`, `OTHER`)
   * `birthYear Int?`
   * `gender Gender`
   * `residesHere Boolean @default(true)`
3. **Extend `PropertyEntry` Model:**
   * `ownershipShares Int @default(2400)` (Valid values: 1 to 2400)

### 2. Validation Schemas (`packages/shared-schemas`)
1. Update `personalDetailsObject` in `citizen.schema.ts` to validate `dateOfBirth`, `motherName`, and `registrationPlace`.
2. Update `primitives.ts` to loosen `lebanesePhone` into a general phone validator supporting landlines and international country codes.
3. Update `property.schema.ts` to include `ownershipShares: z.number().int().min(1).max(2400).default(2400)` in `occupancyBranch`.

### 3. Billing Engine (`apps/backend/src/infrastructure/fees`)
1. **Fix F-01 & F-02:** Ensure `resolveTargets()` and `assessTargets()` query identical sets of active property cards rather than dropping earlier registrations upon re-filing.
2. **Apply Share Multiplier:** In `assessCitizen()`, calculate unit charge multiplied by `(propertyEntry.ownershipShares / 2400)`.
3. **Idempotency on `issue()` (F-04):** Enforce an `idempotencyKey` on fee issuance requests to avoid double-billing on network retries or multiple clicks.

---

## 6. Summary for Municipal Stakeholders

This design ensures that:
* **The Municipality Collects Fairly:** Heirs are never overcharged; debts attach correctly to owners vs occupants.
* **Demographics are Accurate:** The municipal dashboard reflects real citizens, vulnerable households, and exact population numbers without duplicate inflation.
* **Field Officers Are Never Blocked:** Flexible ordering, international phones, and clear identity disambiguation make data gathering smooth and reliable on Day 1.
