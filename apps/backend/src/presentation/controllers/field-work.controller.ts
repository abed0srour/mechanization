import { Body, Controller, Delete, Get, Header, Param, Post, Query } from '@nestjs/common';
import {
  assignZoneSchema,
  syncBatchSchema,
  type AssignZoneInput,
  type SyncBatchInput,
  type VisitDisposition,
} from '@mechanization/shared-schemas';
import { FieldWorkService } from '../../application/features/field-work/field-work.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * Sits under `t/:tenantSlug` like every other tenant-scoped controller — that
 * prefix is what `TenantMiddleware` binds to, so a route outside it would run
 * with no tenant-scoped Prisma client at all.
 *
 * ── Who may do what ──────────────────────────────────────────────────────
 *
 * The split follows one distinction: **who actually walks the street.**
 *
 *   `FIELD_INSPECTOR` is the only role that does. The worklist and the sync
 *   endpoint are theirs alone — not because the others are untrusted, but
 *   because a worklist is "the doors assigned to you", and it is meaningless
 *   for a role that is never assigned any. A SUPER_ADMIN opening it would get
 *   an empty screen that looks broken.
 *
 *   `SUPER_ADMIN` and `ADMINISTRATIVE_OFFICER` supervise: they hand out
 *   shares, read coverage, and file completed drafts from the counter. They do
 *   not collect, so they do not sync.
 *
 *   `AUDITOR` reads coverage and the follow-up queue and writes nothing,
 *   matching how it reads the register everywhere else.
 *
 * Coverage and the follow-up queue are supervision, so the inspector is kept
 * out of them too: they report named employees' progress against one another,
 * which is a management view rather than a working one. An inspector's own
 * state lives on their worklist, where it is about the next door rather than
 * about how they compare.
 *
 *   `COLLECTOR` and `ACCOUNTANT` are money roles with no part in the survey,
 *   and appear nowhere below.
 *
 * Restricting sync to inspectors also removes the last hole in the parcel
 * partition: with no privileged writer, *every* visit is checked against the
 * writer's own share, with no exception for anyone.
 */
@Controller('t/:tenantSlug/field-work')
export class FieldWorkController {
  constructor(private readonly fieldWork: FieldWorkService) {}

  // ──────────────────────────────  Worklist  ───────────────────────────────

  /**
   * The offline bundle: every door this worker is responsible for, with its
   * visit history and any draft to resume.
   *
   * `no-store` because a stale worklist is actively harmful — it would send
   * someone back to a house that was registered this morning. The device caches
   * this itself, deliberately and with a visible "synced at" timestamp, rather
   * than having an HTTP cache do it invisibly.
   */
  @Roles('FIELD_INSPECTOR')
  @Get('worklist')
  @Header('Cache-Control', 'no-store')
  async worklist(@CurrentUser() user: SessionClaims) {
    return this.fieldWork.worklistFor(user.sub);
  }

  /**
   * Push everything the device recorded while offline.
   *
   * One batch rather than a request per record: a worker back from a day in a
   * sector with no signal has a hundred of them, and a hundred round trips over
   * a village connection is how a sync gets abandoned halfway. Every record
   * reports its own outcome, so one bad visit costs the other ninety-nine
   * nothing.
   */
  @Roles('FIELD_INSPECTOR')
  @Post('sync')
  async sync(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(syncBatchSchema)) body: SyncBatchInput,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fieldWork.sync(tenantSlug, body, { id: user.sub, role: user.role ?? '' });
  }

  /**
   * File a completed draft as a real citizen record.
   *
   * Promotion runs the identical create path against the identical validator,
   * so it is held to the register's write roles rather than to the survey's —
   * minus `COLLECTOR`, who may take a payment but has no business entering a
   * household onto the register.
   */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER', 'FIELD_INSPECTOR')
  @Post('drafts/:draftId/promote')
  async promote(
    @Param('tenantSlug') tenantSlug: string,
    @Param('draftId') draftId: string,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fieldWork.promoteDraft(tenantSlug, draftId, {
      id: user.sub,
      role: user.role ?? '',
    });
  }

  // ─────────────────────────────  Supervision  ─────────────────────────────

  /**
   * Coverage per sector.
   *
   * The survey's own roles, not every staff role. Unlike the zone list — which
   * is part of reading the map and open to everyone — this reports on named
   * employees' progress, and a collector or an accountant has no call to see
   * how fast a colleague is working.
   */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER', 'AUDITOR')
  @Get('coverage')
  @Header('Cache-Control', 'no-store')
  async coverage() {
    return { zones: await this.fieldWork.coverage() };
  }

  /** Everything still open, soonest due first. */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER', 'AUDITOR')
  @Get('follow-ups')
  async followUps(
    @Query('disposition') disposition?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      items: await this.fieldWork.followUps({
        disposition: disposition as VisitDisposition | undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  /** Every visit to one door — the history behind a follow-up. */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER', 'AUDITOR')
  @Get('parcels/:parcelNumber/visits')
  async history(@Param('parcelNumber') parcelNumber: string) {
    return { visits: await this.fieldWork.visitHistory(parcelNumber) };
  }

  // ─────────────────────────────  Assignment  ──────────────────────────────

  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER', 'AUDITOR')
  @Get('assignments')
  async listAssignments(@Query('includeReleased') includeReleased?: string) {
    return { assignments: await this.fieldWork.listAssignments(includeReleased === 'true') };
  }

  /**
   * Assigning a share decides who is accountable for which doors, and the
   * partition it creates is what keeps two workers off the same house while
   * both are offline. That makes it an administrative act rather than
   * day-to-day case work — the clerical role's remit, not the inspector's,
   * matching how the zones themselves are drawn. An inspector who could hand
   * themselves a share could also hand themselves someone else's.
   */
  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER')
  @Post('assignments')
  async assign(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(assignZoneSchema)) body: AssignZoneInput,
    @CurrentUser() user: SessionClaims,
  ) {
    return {
      assignments: await this.fieldWork.assign(tenantSlug, body, {
        id: user.sub,
        role: user.role ?? '',
      }),
    };
  }

  @Roles('SUPER_ADMIN', 'ADMINISTRATIVE_OFFICER')
  @Delete('assignments/:id')
  async release(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionClaims,
  ) {
    await this.fieldWork.release(tenantSlug, id, { id: user.sub, role: user.role ?? '' });
    return { released: true };
  }
}
