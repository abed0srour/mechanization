import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../../generated/tenant-client';
import type {
  HouseholdMemberInput,
  HouseholdRelation,
  LinkHousehold,
} from '@mechanization/shared-schemas';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';
import { ConflictError, NotFoundError, ValidationError } from '../../common/exceptions';
import { likePattern } from '../../common/search-terms';
import {
  MAX_CANDIDATES,
  resolve,
  type Resolution,
  type TokenFrequencies,
} from '../../common/record-linkage';
import {
  civilRecordKey,
  duplicateCitizenSpec,
  householdMemberSpec,
  householdSlotSpec,
  landlordSpec,
  toNameSet,
  yearOf,
  type CitizenCandidate,
  type LandlordCandidate,
  type LinkageSubject,
  type MemberCandidate,
} from './household-linkage';

/**
 * Households, and the resolver that decides who belongs to one.
 *
 * The order of the three mechanisms below is the whole design, and it runs from
 * most reliable to least:
 *
 *  1. **The citizen says so.** `claimByReference` — «هل أحد من أفراد أسرتك
 *     مسجّل مسبقاً؟», answered with the رقم مرجعي already printed on the
 *     relative's slip. A person knows their own household perfectly, so this is
 *     the only path that links without a clerk weighing anything.
 *  2. **A clerk confirms.** `resolve` proposes; a human asks the citizen a
 *     question the records do not answer and calls `link`.
 *  3. **Nothing happens.** Which is a fine outcome, and much cheaper than the
 *     alternative: a duplicate household is one merge somebody does later,
 *     while a wrong link puts another family's children on a man's file.
 *
 * Nothing in this service links on a score alone. `resolve` returns proposals
 * and never writes.
 */
@Injectable()
export class HouseholdsService {
  private readonly logger = new Logger(HouseholdsService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly cache: RedisCacheService,
    private readonly events: EventEmitter2,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  // ────────────────────────────  Frequencies  ────────────────────────────

  /**
   * Ten minutes.
   *
   * These are name statistics over the whole register, and they move at the pace
   * registrations are filed. A stale-by-ten-minutes frequency shifts a weight by
   * a fraction of a bit, which cannot flip an outcome — the thresholds are whole
   * numbers apart. Recomputing per resolution would put a full-table aggregate
   * behind every keystroke on the entry form.
   */
  private static readonly FREQUENCY_TTL_SECONDS = 600;

  /**
   * How common each name token is in this municipality.
   *
   * This is what stops the resolver ranking strangers above relatives in a town
   * with a dominant family name: agreeing on «خليل» where two in five households
   * are خليل carries almost no information, and the engine can only know that if
   * somebody counts. See `frequencyWeight`.
   *
   * Counted with `count(DISTINCT id)` rather than `count(*)`: the question is how
   * many *people* carry a token, and a row whose reference number happens to
   * repeat a name token should not make that name look commoner than it is.
   */
  private async frequencies(): Promise<TokenFrequencies> {
    const key = `households:tokens:${this.tenantContext.tenantSlug}`;
    const cached = await this.cache.get<{ total: number; counts: [string, number][] }>(key);
    if (cached) return { total: cached.total, counts: new Map(cached.counts) };

    const [rows, [{ total }]] = await withConnectionRetry(() =>
      this.db.$transaction([
        this.db.$queryRaw<Array<{ token: string; n: number }>>`
          SELECT token, count(DISTINCT id)::int AS n
            FROM (
              SELECT u.id, unnest(string_to_array(u."searchText", ' ')) AS token
                FROM users u
               WHERE u.kind = 'CITIZEN'
            ) t
           WHERE length(token) > 1
           GROUP BY token
        `,
        this.db.$queryRaw<Array<{ total: number }>>`
          SELECT count(*)::int AS total FROM users WHERE kind = 'CITIZEN'
        `,
      ]),
    );

    const counts = rows.map((row) => [row.token, row.n] as [string, number]);
    await this.cache.set(key, { total, counts }, HouseholdsService.FREQUENCY_TTL_SECONDS);

    return { total, counts: new Map(counts) };
  }

  // ─────────────────────────────  Subjects  ─────────────────────────────

  /**
   * The person being placed, assembled from whatever the caller holds.
   *
   * Deliberately built from loose fields rather than from a `User` row, so the
   * entry form can resolve a citizen *while they are being typed* — which is the
   * only moment a clerk can still ask them a question. Resolving after the save
   * means calling the household back.
   */
  buildSubject(input: {
    citizenId?: string;
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
    motherName?: string | null;
    dateOfBirth?: Date | string | null;
    gender?: string | null;
    civilRecordNumber?: string | null;
    registrationPlaceTown?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    altPhone?: string | null;
    ownedParcelNumbers?: ReadonlyArray<string | null | undefined>;
  }): LinkageSubject {
    return {
      citizenId: input.citizenId,
      name: toNameSet(input.firstName, input.middleName, input.lastName),
      motherName: input.motherName ?? null,
      birthYear: yearOf(input.dateOfBirth),
      gender: input.gender ?? null,
      civilRecordKey: civilRecordKey(input.civilRecordNumber, input.registrationPlaceTown),
      phones: [input.phone, input.whatsapp, input.altPhone],
      ownedParcelNumbers: new Set(
        (input.ownedParcelNumbers ?? [])
          .filter((value): value is string => Boolean(value))
          .map((value) => value.trim()),
      ),
    };
  }

  // ─────────────────────────────  Resolution  ─────────────────────────────

  /**
   * Everything the register thinks this person might already be.
   *
   * Three questions over one engine. Read-only, always — a proposal is a thing a
   * clerk acts on, never a thing that has already happened.
   *
   * Note what is deliberately *not* returned: the candidate household's roster.
   * The banner this replaced showed an arriving man the names and ages of
   * another family's children before he had confirmed any relationship to them,
   * which discloses a household to a stranger whenever the match is wrong. What
   * comes back is enough to identify a candidate and no more; the confirming
   * question is put to the citizen, and the answer they give is what the clerk
   * matches against.
   */
  async resolveForCitizen(subject: LinkageSubject): Promise<{
    household: Resolution<MemberCandidate>;
    duplicate: Resolution<CitizenCandidate>;
    landlord: Resolution<LandlordCandidate>;
  }> {
    const frequencies = await this.frequencies();

    const [members, citizens, landlords] = await Promise.all([
      this.memberCandidates(subject),
      this.citizenCandidates(subject),
      this.landlordCandidates(subject),
    ]);

    return {
      household: resolve(subject, members, householdMemberSpec(frequencies)),
      duplicate: resolve(subject, citizens, duplicateCitizenSpec(frequencies)),
      landlord: resolve(subject, landlords, landlordSpec(frequencies)),
    };
  }

  /**
   * Warns when a block came back at the cap.
   *
   * Not truncation-and-carry-on: a predicate returning a hundred people has
   * selected on something as unspecific as a family name, and the top score in
   * such a set is likelier to be the commonest record than the right one. The
   * resolution still runs — a wide block is not a reason to refuse a clerk an
   * answer — but the log says the answer is worth less than usual.
   */
  private capped<T>(rows: T[], block: string): T[] {
    if (rows.length > MAX_CANDIDATES) {
      this.logger.warn(
        `Linkage block "${block}" returned more than ${MAX_CANDIDATES} candidates in ${this.tenantContext.tenantSlug} — scores from this set are weak`,
      );
    }
    return rows.slice(0, MAX_CANDIDATES);
  }

  /**
   * Candidate roster slots: unfilled rows that share *something* with the subject.
   *
   * Recall-oriented on purpose. Blocking exists to bound the work, not to decide
   * anything — a candidate wrongly admitted here is scored and discarded, while
   * one wrongly excluded can never be found again. So a single shared name token
   * is enough to be considered, even though two are needed to agree.
   *
   * The سجل clause is the honest use of the fact the design document overrated.
   * A سجل identifies a patrilineal family record — a man, his father, his
   * brothers, their wives and their children all carry the same one — so it can
   * never show that two people are a couple. What it can do is bound a search
   * cheaply, which is what it does here and nowhere else.
   */
  private async memberCandidates(subject: LinkageSubject): Promise<MemberCandidate[]> {
    const tokens = [...subject.name];
    const phones = subject.phones.filter((value): value is string => Boolean(value));

    if (tokens.length === 0 && phones.length === 0 && !subject.civilRecordKey) return [];

    const clauses: Prisma.Sql[] = [];

    if (tokens.length > 0) {
      clauses.push(
        Prisma.join(
          tokens.map((token) => Prisma.sql`m."searchText" LIKE ${likePattern(token)}`),
          ' OR ',
        ),
      );
    }
    if (subject.civilRecordKey) {
      clauses.push(
        Prisma.sql`lower(btrim(head."civilRecordNumber") || '@' || btrim(head."registrationPlaceTown")) = ${subject.civilRecordKey}`,
      );
    }
    if (phones.length > 0) {
      const list = Prisma.join(phones.map((phone) => Prisma.sql`${phone}`));
      clauses.push(
        Prisma.sql`(head.phone IN (${list}) OR head."altPhone" IN (${list}) OR head.whatsapp IN (${list}))`,
      );
    }

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          memberId: string;
          householdId: string;
          fullName: string;
          relationToHead: string;
          birthYear: number | null;
          gender: string | null;
          headFirstName: string | null;
          headMiddleName: string | null;
          headLastName: string | null;
          headCivilRecordNumber: string | null;
          headRegistrationPlaceTown: string | null;
          headPhone: string | null;
          headAltPhone: string | null;
          headWhatsapp: string | null;
        }>
      >`
        SELECT m.id                          AS "memberId",
               m."householdId",
               m."fullName",
               m."relationToHead"::text      AS "relationToHead",
               m."birthYear",
               m.gender::text                AS gender,
               head."firstName"              AS "headFirstName",
               head."middleName"             AS "headMiddleName",
               head."lastName"               AS "headLastName",
               head."civilRecordNumber"      AS "headCivilRecordNumber",
               head."registrationPlaceTown"  AS "headRegistrationPlaceTown",
               head.phone                    AS "headPhone",
               head."altPhone"               AS "headAltPhone",
               head.whatsapp                 AS "headWhatsapp"
          FROM household_members m
          JOIN households h   ON h.id = m."householdId"
          LEFT JOIN users head ON head.id = h."headId"
         WHERE m."linkedCitizenId" IS NULL
           AND (${Prisma.join(clauses, ' OR ')})
         LIMIT ${MAX_CANDIDATES + 1}
      `,
    );

    return this.capped(rows, 'household-member').map((row) => ({
      memberId: row.memberId,
      householdId: row.householdId,
      name: toNameSet(row.fullName),
      birthYear: row.birthYear,
      gender: row.gender,
      relationToHead: row.relationToHead,
      headName: toNameSet(row.headFirstName, row.headMiddleName, row.headLastName),
      headCivilRecordKey: civilRecordKey(
        row.headCivilRecordNumber,
        row.headRegistrationPlaceTown,
      ),
      householdPhones: [row.headPhone, row.headAltPhone, row.headWhatsapp],
    }));
  }

  /** Citizens already on file who might be this same person. */
  private async citizenCandidates(subject: LinkageSubject): Promise<CitizenCandidate[]> {
    const tokens = [...subject.name];
    if (tokens.length === 0) return [];

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          firstName: string;
          middleName: string | null;
          lastName: string;
          motherName: string | null;
          dateOfBirth: Date | null;
          gender: string | null;
          civilRecordNumber: string | null;
          registrationPlaceTown: string | null;
          phone: string | null;
          altPhone: string | null;
          whatsapp: string | null;
        }>
      >`
        SELECT u.id, u."firstName", u."middleName", u."lastName", u."motherName",
               u."dateOfBirth", u.gender::text AS gender, u."civilRecordNumber",
               u."registrationPlaceTown", u.phone, u."altPhone", u.whatsapp
          FROM users u
         WHERE u.kind = 'CITIZEN'
           AND u."isActive" = true
           AND u.id <> COALESCE(${subject.citizenId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND (${Prisma.join(
             tokens.map((token) => Prisma.sql`u."searchText" LIKE ${likePattern(token)}`),
             ' OR ',
           )})
         LIMIT ${MAX_CANDIDATES + 1}
      `,
    );

    return this.capped(rows, 'duplicate-citizen').map((row) => ({
      citizenId: row.id,
      name: toNameSet(row.firstName, row.middleName, row.lastName),
      motherName: row.motherName,
      birthYear: yearOf(row.dateOfBirth),
      gender: row.gender,
      civilRecordKey: civilRecordKey(row.civilRecordNumber, row.registrationPlaceTown),
      phones: [row.phone, row.altPhone, row.whatsapp],
    }));
  }

  /**
   * «اسم المالك» written on somebody else's card.
   *
   * The question the design document listed as Case 4 — a son registers his flat
   * as شاغل بتسامح naming his father, and the father registers the building
   * weeks later — and it costs nothing extra because it is the same engine over
   * a different pair. The parcel number is what makes it strong: two people
   * recorded the same رقم عقار at different times without either knowing of the
   * other.
   *
   * `search_normalize` is called inline rather than read from a stored column;
   * `property_entries` has no generated one, and adding it for a query that runs
   * once per registration is a table rewrite this does not need. The parcel
   * clause carries the selectivity when a parcel is known.
   */
  private async landlordCandidates(subject: LinkageSubject): Promise<LandlordCandidate[]> {
    const tokens = [...subject.name];
    const parcels = [...subject.ownedParcelNumbers];
    if (tokens.length === 0 && parcels.length === 0) return [];

    const clauses: Prisma.Sql[] = [];
    if (tokens.length > 0) {
      clauses.push(
        Prisma.join(
          tokens.map(
            (token) => Prisma.sql`search_normalize(pe."landlordName") LIKE ${likePattern(token)}`,
          ),
          ' OR ',
        ),
      );
    }
    if (parcels.length > 0) {
      clauses.push(
        Prisma.sql`pe."propertyNumber" IN (${Prisma.join(parcels.map((p) => Prisma.sql`${p}`))})`,
      );
    }

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          citizenId: string;
          landlordName: string | null;
          landlordPhone: string | null;
          propertyNumber: string | null;
        }>
      >`
        SELECT pe.id, r."citizenId", pe."landlordName", pe."landlordPhone", pe."propertyNumber"
          FROM property_entries pe
          JOIN registrations r ON r.id = pe."registrationId"
         WHERE pe."occupancyType" <> 'OWNER'
           AND pe."landlordName" IS NOT NULL
           AND r."citizenId" <> COALESCE(${subject.citizenId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND (${Prisma.join(clauses, ' OR ')})
         LIMIT ${MAX_CANDIDATES + 1}
      `,
    );

    return this.capped(rows, 'landlord').map((row) => ({
      propertyEntryId: row.id,
      filedByCitizenId: row.citizenId,
      name: toNameSet(row.landlordName),
      landlordPhone: row.landlordPhone,
      propertyNumber: row.propertyNumber,
    }));
  }

  // ──────────────────────────────  Writes  ──────────────────────────────

  /**
   * A household for a citizen who has just registered, and the people they named.
   *
   * The registrant becomes both the head and a `HEAD` roster row. Storing them on
   * the roster rather than implying them from `headId` is what makes the roster
   * the household's whole population — every count filters `residesHere` and
   * needs no special case for the person at the top.
   */
  async createFor(input: {
    citizenId: string;
    members: ReadonlyArray<HouseholdMemberInput>;
    label?: string | null;
    actor: { id: string; role: string };
  }) {
    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: { id: true, householdId: true, firstName: true, middleName: true, lastName: true },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);
    if (citizen.householdId) {
      throw new ConflictError('هذا المواطن مرتبط بأسرة مسجّلة مسبقاً');
    }

    const household = await this.db.$transaction(async (tx) => {
      const created = await tx.household.create({
        data: { headId: citizen.id, label: input.label ?? null },
        select: { id: true },
      });

      await tx.user.update({
        where: { id: citizen.id },
        data: { householdId: created.id },
      });

      await tx.householdMember.create({
        data: {
          householdId: created.id,
          fullName: [citizen.firstName, citizen.middleName, citizen.lastName]
            .filter(Boolean)
            .join(' '),
          relationToHead: 'HEAD',
          linkedCitizenId: citizen.id,
          linkedVia: 'SELF',
          linkedAt: new Date(),
          linkedById: input.actor.id,
        },
      });

      if (input.members.length > 0) {
        await tx.householdMember.createMany({
          data: input.members.map((member) => ({
            householdId: created.id,
            fullName: member.fullName,
            relationToHead: member.relationToHead as never,
            birthYear: member.birthYear ?? null,
            gender: (member.gender ?? null) as never,
            residesHere: member.residesHere,
          })),
        });
      }

      return created;
    });

    this.events.emit('citizen.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      citizenId: citizen.id,
      action: 'HOUSEHOLD_CREATED',
      after: { householdId: household.id, memberCount: input.members.length + 1 },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { householdId: household.id };
  }

  /**
   * The citizen's own answer, and the only path that links without a judgement.
   *
   * «هل أحد من أفراد أسرتك مسجّل مسبقاً؟» — answered with the رقم مرجعي printed
   * on that relative's slip. It is exact, it is unguessable at the rate the login
   * route is limited to, and it is supplied by the one party who knows the answer
   * for certain. Everything probabilistic in this file is the fallback for when
   * this question goes unanswered.
   *
   * Still routed through `link`, so a citizen-supplied claim leaves the same
   * audit trail a clerk's does — with `linkedVia` recording which it was.
   */
  /**
   * Who a رقم مرجعي belongs to, before anything is saved.
   *
   * The field that takes this number used to do nothing visible until the record
   * was submitted — and then, at best, reported a failure. An officer had no way
   * to tell a number that would work from one that would not, which made the
   * whole mechanism unverifiable at exactly the moment it could still be fixed:
   * while the citizen is standing there.
   *
   * What comes back is the name, which is the point. The officer reads it back —
   * «إبراهيم نصرالله، صحّ؟» — and the citizen confirms or corrects. That is the
   * confirmation step, and it is not a disclosure: the citizen supplied this
   * number themselves, so the household is one they already named. It is the
   * opposite of the match banner, which must never show a household the *system*
   * guessed at.
   */
  async previewByReference(reference: string) {
    const trimmed = reference.trim().toUpperCase().replace(/\s/g, '');

    const relative = await this.db.user.findFirst({
      where: { referenceNumber: trimmed, kind: 'CITIZEN', isActive: true },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        householdId: true,
      },
    });

    if (!relative) return { found: false as const };

    const memberCount = relative.householdId
      ? await this.db.householdMember.count({ where: { householdId: relative.householdId } })
      : 0;

    return {
      found: true as const,
      citizenId: relative.id,
      citizenName: [relative.firstName, relative.middleName, relative.lastName]
        .filter(Boolean)
        .join(' '),
      /**
       * False is a perfectly good outcome, not a failure — it is every citizen
       * filed before rosters existed. Saving will create the household with
       * this relative at its head and put both of them in it, so the officer
       * should be told that rather than left wondering.
       */
      hasHousehold: relative.householdId !== null,
      memberCount,
    };
  }

  async claimByReference(input: {
    citizenId: string;
    referenceNumber: string;
    actor: { id: string; role: string };
  }) {
    const reference = input.referenceNumber.trim().toUpperCase();

    const relative = await this.db.user.findFirst({
      where: { referenceNumber: reference, kind: 'CITIZEN', isActive: true },
      select: {
        id: true,
        householdId: true,
        firstName: true,
        middleName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
      },
    });

    if (!relative) throw new NotFoundError('Citizen', reference);

    /*
      A registered relative with no household is the *commonest* case, not an
      error — every citizen filed before the roster existed is in it, and so is
      anyone whose officer did not enumerate a family.

      Refusing here was the wrong answer to a valid reference: the citizen said
      «أخي مسجّل», the brother is demonstrably on the register, and the only
      thing missing is the row that says the two are a family. So one is created,
      with the relative at its head — which is what the arriving citizen just
      asserted.
    */
    const householdId =
      relative.householdId ??
      (
        await this.db.$transaction(async (tx) => {
          const created = await tx.household.create({
            data: { headId: relative.id },
            select: { id: true },
          });
          await tx.user.update({
            where: { id: relative.id },
            data: { householdId: created.id },
          });
          await tx.householdMember.create({
            data: {
              householdId: created.id,
              fullName: [relative.firstName, relative.middleName, relative.lastName]
                .filter(Boolean)
                .join(' '),
              relationToHead: 'HEAD',
              gender: relative.gender as never,
              birthYear: yearOf(relative.dateOfBirth),
              residesHere: true,
              linkedCitizenId: relative.id,
              linkedVia: 'SELF',
              linkedAt: new Date(),
              linkedById: input.actor.id,
            },
          });
          return created;
        })
      ).id;

    /*
      The reference says *which household* with certainty. It does not say which
      person inside it, and that is a separate question with a separate answer.

      So the arriving citizen is scored against this household's unfilled slots
      only — a search of at most a handful of rows, where the relations were
      already stated by whoever described them. A clear winner is filled, keeping
      the relation the describer gave: the wife who wrote «زوج» answered that
      question weeks ago, and re-asking would invite a clerk to overwrite her
      with a guess.

      No clear winner means a new row rather than a coin toss — `OTHER`, which is
      an admission rather than a description, and which the roster editor puts in
      front of somebody to correct.
    */
    const slot = await this.matchWithinHousehold(householdId, input.citizenId);

    return this.link({
      citizenId: input.citizenId,
      input: {
        householdId,
        memberId: slot ?? undefined,
        relationToHead: slot ? undefined : 'OTHER',
        confirmation: `الرقم المرجعي ${reference} قدّمه المواطن`,
      },
      via: 'REFERENCE',
      actor: input.actor,
    });
  }

  /**
   * Which unfilled slot in one known household this citizen is, if any.
   *
   * The same engine and the same spec the open search uses, over a candidate set
   * of at most a few rows — so `AMBIGUOUS` here means two siblings the roster
   * describes identically, and the honest answer is still "do not choose".
   */
  private async matchWithinHousehold(
    householdId: string,
    citizenId: string,
  ): Promise<string | null> {
    const [citizen, rows, frequencies] = await Promise.all([
      this.db.user.findUnique({
        where: { id: citizenId },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          motherName: true,
          dateOfBirth: true,
          gender: true,
          civilRecordNumber: true,
          registrationPlaceTown: true,
          phone: true,
          whatsapp: true,
          altPhone: true,
        },
      }),
      this.db.householdMember.findMany({
        where: { householdId, linkedCitizenId: null },
        select: {
          id: true,
          fullName: true,
          birthYear: true,
          gender: true,
          relationToHead: true,
        },
      }),
      this.frequencies(),
    ]);

    if (!citizen || rows.length === 0) return null;

    const subject = this.buildSubject({ ...citizen, citizenId: citizen.id });

    const candidates: MemberCandidate[] = rows.map((row) => ({
      memberId: row.id,
      householdId,
      name: toNameSet(row.fullName),
      birthYear: row.birthYear,
      gender: row.gender,
      relationToHead: row.relationToHead,
      /*
        Left empty, and `householdSlotSpec` does not read them anyway — stated
        twice on purpose, because either alone would be a trap for whoever
        changes the other. Which household this is was settled by the رقم
        مرجعي, so the head's name, سجل and phone are the same for every
        candidate here: scoring them separates nobody and lifts everybody.
      */
      headName: new Set<string>(),
      headCivilRecordKey: null,
      householdPhones: [],
    }));

    const outcome = resolve(subject, candidates, householdSlotSpec(frequencies));
    return outcome.outcome === 'LINK' ? (outcome.best?.candidate.memberId ?? null) : null;
  }

  /**
   * Joins a citizen to a household — filling a slot somebody described, or
   * adding a row for somebody nobody did.
   *
   * `confirmation` is required by the schema and is the only part of this a later
   * reader can weigh. A score records that the system thought two records
   * matched; this records that a named person asked and was told. Six months on,
   * a correct link and a wrong one are indistinguishable without it.
   */
  async link(input: {
    citizenId: string;
    input: LinkHousehold;
    via?: 'CLERK' | 'REFERENCE' | 'DOCUMENT';
    actor: { id: string; role: string };
  }) {
    const [citizen, household] = await Promise.all([
      this.db.user.findFirst({
        where: { id: input.citizenId, kind: 'CITIZEN' },
        select: {
          id: true,
          householdId: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      }),
      this.db.household.findUnique({
        where: { id: input.input.householdId },
        select: { id: true },
      }),
    ]);

    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);
    if (!household) throw new NotFoundError('Household', input.input.householdId);

    /*
      Refused rather than moved.

      A citizen already in a household who "matches" another one is either a
      mistake or a genuine move, and the two need opposite handling — the first
      must not be committed at all, the second wants the old household's roster
      corrected as well. Silently repointing the column would do the first and
      pretend it was the second. `unlink` first, deliberately, then link.
    */
    if (citizen.householdId && citizen.householdId !== household.id) {
      throw new ConflictError('هذا المواطن مرتبط بأسرة أخرى — يجب فك الربط أولاً');
    }

    /*
      Already here. Nothing to do, and saying so beats doing it twice.

      Reachable in ordinary use: a clerk re-saves an edit that still carries the
      رقم مرجعي they typed last time, or a citizen quotes their own. Falling
      through would try to write a second roster row for one person, which
      `household_members.linkedCitizenId` is unique precisely to refuse — so the
      officer would see a constraint violation for having changed nothing.
    */
    if (citizen.householdId === household.id) {
      return { householdId: household.id, linkedVia: input.via ?? 'CLERK', alreadyLinked: true };
    }

    const via = input.via ?? 'CLERK';

    await this.db.$transaction(async (tx) => {
      if (input.input.memberId) {
        // Scoped to this household and to an unfilled slot in the same statement:
        // an id belonging to another family's roster must not be steerable into
        // this link, and a slot somebody else already filled must not be stolen.
        const claimed = await tx.householdMember.updateMany({
          where: {
            id: input.input.memberId,
            householdId: household.id,
            linkedCitizenId: null,
          },
          data: {
            linkedCitizenId: citizen.id,
            linkedVia: via,
            linkedAt: new Date(),
            linkedById: input.actor.id,
          },
        });

        if (claimed.count === 0) {
          throw new ConflictError('هذا السطر غير متاح للربط — قد يكون مرتبطاً بمواطن آخر');
        }
      } else {
        if (!input.input.relationToHead) {
          throw new ValidationError('صلة القرابة مطلوبة عند إضافة فرد جديد إلى الأسرة', {
            relationToHead: '',
          });
        }

        await tx.householdMember.create({
          data: {
            householdId: household.id,
            fullName: [citizen.firstName, citizen.middleName, citizen.lastName]
              .filter(Boolean)
              .join(' '),
            relationToHead: input.input.relationToHead as never,
            linkedCitizenId: citizen.id,
            linkedVia: via,
            linkedAt: new Date(),
            linkedById: input.actor.id,
          },
        });
      }

      await tx.user.update({
        where: { id: citizen.id },
        data: { householdId: household.id },
      });
    });

    this.events.emit('citizen.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      citizenId: citizen.id,
      action: 'HOUSEHOLD_LINKED',
      after: {
        householdId: household.id,
        memberId: input.input.memberId ?? null,
        via,
        confirmation: input.input.confirmation,
      },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { householdId: household.id, linkedVia: via, alreadyLinked: false };
  }

  /**
   * Undoing one, which is the operation that makes linking safe to attempt.
   *
   * The roster row survives with its `linkedCitizenId` nulled rather than being
   * deleted: somebody described that person, and their description is still true
   * — what was wrong is the claim that this citizen is them. Deleting the row
   * would quietly shrink a household because a clerk corrected an identification.
   */
  async unlink(input: {
    citizenId: string;
    reason: string;
    actor: { id: string; role: string };
  }) {
    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: { id: true, householdId: true },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);
    if (!citizen.householdId) throw new ConflictError('هذا المواطن غير مرتبط بأي أسرة');

    const householdId = citizen.householdId;

    await this.db.$transaction(async (tx) => {
      await tx.householdMember.updateMany({
        where: { linkedCitizenId: citizen.id },
        data: { linkedCitizenId: null, linkedVia: null, linkedAt: null, linkedById: null },
      });

      // Headship goes with the membership. A household headed by somebody who is
      // no longer in it is a roster whose every `relationToHead` points at a
      // stranger.
      await tx.household.updateMany({
        where: { id: householdId, headId: citizen.id },
        data: { headId: null },
      });

      await tx.user.update({ where: { id: citizen.id }, data: { householdId: null } });
    });

    this.events.emit('citizen.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      citizenId: citizen.id,
      action: 'HOUSEHOLD_UNLINKED',
      before: { householdId },
      after: { reason: input.reason },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { unlinked: true };
  }

  /**
   * Moves رب الأسرة, and reports what that invalidated.
   *
   * Its own operation rather than a side effect of a link, because every
   * `relationToHead` on the roster is written against this one person — so
   * moving it silently relabels a document nobody re-read. The design note that
   * prompted this had the arriving husband promoted automatically on link, which
   * would have turned his wife's «husband» row and his children's «child» rows
   * into statements about a different anchor without anyone being told.
   *
   * One case is safe to apply and it is the common one: **a swap between
   * spouses.** `SPOUSE` and `CHILD` are the relations invariant under it — the
   * wife of the head becomes the head and the head becomes her spouse, and their
   * children are the children of either. Everything else — a `PARENT`, a
   * `SIBLING`, a `RELATIVE` — describes a tie to the *old* head and is now
   * unstated. Those rows are returned rather than guessed at, for the same
   * reason `assessCitizen` refuses to invent a unit count.
   */
  async setHead(input: {
    householdId: string;
    citizenId: string;
    actor: { id: string; role: string };
  }) {
    const household = await this.db.household.findUnique({
      where: { id: input.householdId },
      select: {
        id: true,
        headId: true,
        roster: {
          select: { id: true, fullName: true, relationToHead: true, linkedCitizenId: true },
        },
      },
    });
    if (!household) throw new NotFoundError('Household', input.householdId);

    const incoming = household.roster.find((row) => row.linkedCitizenId === input.citizenId);
    if (!incoming) {
      throw new ConflictError('لا يمكن جعل شخص من خارج الأسرة رباً لها');
    }
    if (household.headId === input.citizenId) {
      return { headId: input.citizenId, needsRestating: [] as Array<{ id: string; fullName: string }> };
    }

    const outgoing = household.roster.find((row) => row.relationToHead === 'HEAD');
    const spouseSwap = incoming.relationToHead === 'SPOUSE';

    /** Rows whose relation described a tie to the head who is being replaced. */
    const needsRestating = household.roster
      .filter((row) => row.id !== incoming.id && row.id !== outgoing?.id)
      .filter((row) => (spouseSwap ? !['SPOUSE', 'CHILD'].includes(row.relationToHead) : true))
      .map((row) => ({ id: row.id, fullName: row.fullName }));

    await this.db.$transaction(async (tx) => {
      await tx.householdMember.update({
        where: { id: incoming.id },
        data: { relationToHead: 'HEAD' },
      });

      if (outgoing) {
        await tx.householdMember.update({
          where: { id: outgoing.id },
          /*
            The outgoing head becomes the new head's spouse only in the swap
            that warrants it. Otherwise `OTHER` — which is not a description so
            much as an admission that the old one no longer holds, and it puts
            the row on the list a clerk is asked to restate.
          */
          data: { relationToHead: spouseSwap ? 'SPOUSE' : 'OTHER' },
        });
      }

      await tx.household.update({
        where: { id: household.id },
        data: { headId: input.citizenId },
      });
    });

    this.events.emit('citizen.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      citizenId: input.citizenId,
      action: 'HOUSEHOLD_HEAD_SET',
      before: { headId: household.headId },
      after: { headId: input.citizenId, needsRestating: needsRestating.length },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { headId: input.citizenId, needsRestating };
  }

  /** One household, roster included — the profile screen's read. */
  async get(householdId: string) {
    const household = await this.db.household.findUnique({
      where: { id: householdId },
      select: {
        id: true,
        label: true,
        headId: true,
        createdAt: true,
        roster: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fullName: true,
            relationToHead: true,
            birthYear: true,
            gender: true,
            residesHere: true,
            linkedCitizenId: true,
            linkedVia: true,
          },
        },
      },
    });
    if (!household) throw new NotFoundError('Household', householdId);

    return {
      id: household.id,
      label: household.label,
      headId: household.headId,
      createdAt: household.createdAt.toISOString(),
      /**
       * The occupancy count, which is the roster minus everyone abroad — and the
       * figure that replaces `sum(familySize)` on the dashboard. Counted once
       * per household rather than once per registered citizen, which is the
       * whole fix: a husband and a wife who each registered are two members of
       * one household here, not two households of six.
       */
      residentCount: household.roster.filter((member) => member.residesHere).length,
      memberCount: household.roster.length,
      roster: household.roster.map((member) => ({
        id: member.id,
        fullName: member.fullName,
        relationToHead: member.relationToHead as HouseholdRelation,
        birthYear: member.birthYear,
        gender: member.gender,
        residesHere: member.residesHere,
        /** Whether this person has a file of their own, not who they are. */
        isRegistered: member.linkedCitizenId !== null,
        citizenId: member.linkedCitizenId,
        linkedVia: member.linkedVia,
      })),
    };
  }
}
