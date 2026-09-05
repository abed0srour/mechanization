import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  householdMembersSchema,
  linkHouseholdSchema,
  setHouseholdHeadSchema,
  unlinkHouseholdSchema,
  type HouseholdMemberInput,
  type LinkHousehold,
  type SetHouseholdHead,
  type UnlinkHousehold,
} from '@mechanization/shared-schemas';
import { z } from 'zod';
import { HouseholdsService } from '../../application/features/households/households.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * What the entry form sends to ask «who might this person already be?».
 *
 * Loose and entirely optional, because the whole point is to answer while the
 * citizen is still being typed — a subject with a first name and nothing else is
 * a legitimate question, and one that returns nothing is a legitimate answer.
 * Nothing here is stored, so nothing here needs the strict schemas.
 */
const resolveSubjectSchema = z.object({
  citizenId: z.string().uuid().optional(),
  firstName: z.string().trim().max(60).optional(),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  motherName: z.string().trim().max(60).optional(),
  dateOfBirth: z.string().trim().max(40).optional(),
  gender: z.string().trim().max(20).optional(),
  civilRecordNumber: z.string().trim().max(20).optional(),
  registrationPlaceTown: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  altPhone: z.string().trim().max(30).optional(),
  ownedParcelNumbers: z.array(z.string().trim().max(40)).max(25).optional(),
});

type ResolveSubject = z.infer<typeof resolveSubjectSchema>;

const createHouseholdSchema = z.object({
  citizenId: z.string().uuid(),
  label: z.string().trim().max(120).optional(),
  members: householdMembersSchema,
});

type CreateHousehold = z.infer<typeof createHouseholdSchema>;

const claimSchema = z.object({ referenceNumber: z.string().trim().min(4).max(40) });

@Controller('t/:tenantSlug/households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  /**
   * Proposals, never actions.
   *
   * Open to every role that can enter a citizen, because it is the same act —
   * this is what the entry form calls as the name is typed. It writes nothing,
   * and the payload it returns is deliberately thin: candidate identifiers and
   * scores, and *not* the candidate household's roster. Showing an arriving man
   * the names and ages of another family's children before he has confirmed any
   * relationship to them discloses a household to a stranger every time the
   * match is wrong.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Post('resolve')
  async resolve(@Body(new ZodValidationPipe(resolveSubjectSchema)) body: ResolveSubject) {
    const subject = this.households.buildSubject(body);
    const { household, duplicate, landlord } = await this.households.resolveForCitizen(subject);

    return {
      household: {
        outcome: household.outcome,
        reason: household.reason,
        best: household.best
          ? {
              householdId: household.best.candidate.householdId,
              memberId: household.best.candidate.memberId,
              relationToHead: household.best.candidate.relationToHead,
              score: Number(household.best.score.toFixed(2)),
              contributions: household.best.contributions,
            }
          : null,
        /** How many others cleared the review threshold — the ambiguity, in one number. */
        alternatives: Math.max(household.shortlist.length - 1, 0),
      },
      /**
       * Reported, never acted on. Merging two citizens moves property cards and
       * invoices onto one file, and the register's rule that two people who
       * cannot be told apart stay two rows is older than this feature.
       */
      duplicate: {
        outcome: duplicate.outcome,
        reason: duplicate.reason,
        citizenId: duplicate.best?.candidate.citizenId ?? null,
        score: duplicate.best ? Number(duplicate.best.score.toFixed(2)) : null,
        alternatives: Math.max(duplicate.shortlist.length - 1, 0),
      },
      /** The «اسم المالك» a tenant wrote that may be this owner. */
      landlord: {
        outcome: landlord.outcome,
        reason: landlord.reason,
        propertyEntryId: landlord.best?.candidate.propertyEntryId ?? null,
        propertyNumber: landlord.best?.candidate.propertyNumber ?? null,
        score: landlord.best ? Number(landlord.best.score.toFixed(2)) : null,
        alternatives: Math.max(landlord.shortlist.length - 1, 0),
      },
    };
  }

  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createHouseholdSchema)) body: CreateHousehold,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.households.createFor({
      citizenId: body.citizenId,
      members: body.members as ReadonlyArray<HouseholdMemberInput>,
      label: body.label,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Declared before `@Get(':id')` — a static segment behind a parameter one is
   * a route that never matches, and the failure is silent.
   *
   * This is what makes the رقم مرجعي field verifiable while it is being typed:
   * it answers whose number this is, so the officer can read the name back to
   * the person who gave it before anything is saved.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Get('by-reference/:reference')
  async byReference(@Param('reference') reference: string) {
    return this.households.previewByReference(reference);
  }

  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'COLLECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER')
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.households.get(id);
  }

  /**
   * The citizen's own answer, and the only route that links on something other
   * than a clerk's judgement — because a رقم مرجعي is not a guess.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Post('citizens/:citizenId/claim')
  async claim(
    @Param('citizenId') citizenId: string,
    @Body(new ZodValidationPipe(claimSchema)) body: { referenceNumber: string },
    @CurrentUser() user: SessionClaims,
  ) {
    return this.households.claimByReference({
      citizenId,
      referenceNumber: body.referenceNumber,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Post('citizens/:citizenId/link')
  async link(
    @Param('citizenId') citizenId: string,
    @Body(new ZodValidationPipe(linkHouseholdSchema)) body: LinkHousehold,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.households.link({
      citizenId,
      input: body,
      via: 'CLERK',
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Unlinking is what makes linking safe to attempt at all, so it is open to the
   * same roles rather than reserved upward. A clerk who has just made a wrong
   * link must be able to undo it without finding an administrator.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR', 'COLLECTOR', 'ADMINISTRATIVE_OFFICER')
  @Post('citizens/:citizenId/unlink')
  async unlink(
    @Param('citizenId') citizenId: string,
    @Body(new ZodValidationPipe(unlinkHouseholdSchema)) body: UnlinkHousehold,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.households.unlink({
      citizenId,
      reason: body.reason,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Moving رب الأسرة re-anchors every relation on the roster, which is an
   * administrative act rather than case work — so it sits with the roles that
   * own the register's shape, and it returns the rows it could not relabel.
   */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER')
  @Post(':id/head')
  async setHead(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setHouseholdHeadSchema)) body: SetHouseholdHead,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.households.setHead({
      householdId: id,
      citizenId: body.citizenId,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }
}
