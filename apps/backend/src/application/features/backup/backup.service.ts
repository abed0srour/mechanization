import { gunzipSync, gzipSync } from 'node:zlib';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { ValidationError } from '../../common/exceptions';
import { Prisma } from '../../../generated/tenant-client';

/**
 * The snapshot format's own version.
 *
 * Bumped whenever the set of tables or the shape of a row changes in a way an
 * older restore could not read. Checked on the way in, because the failure it
 * prevents — a snapshot half-restored before the mismatch is noticed — is not
 * one a municipality can undo.
 */
const SNAPSHOT_VERSION = 1;

/**
 * Every table in a tenant schema, in the order rows may be inserted.
 *
 * Derived from the foreign keys in the tenant Prisma schema, not guessed:
 * `Registration` points at `User`, `PropertyEntry` at `Registration`,
 * `BuildingUnit` and `Document` at `PropertyEntry`, `CitizenPayment` at both
 * `User` and `FeeNotice`. `Parcel`, `Zone`, `OtpChallenge`, `AuditLogEntry` and
 * `SystemSettings` carry no outbound relation and can go anywhere; they are
 * placed early so a failure surfaces on cheap tables first.
 *
 * Deletion walks this list backwards. Getting the order wrong is not a subtle
 * bug — it is a foreign-key violation that aborts the transaction, which is the
 * safe direction for this to fail in.
 */
const TABLE_ORDER = [
  'user',
  'otpChallenge',
  'parcel',
  'zone',
  'auditLogEntry',
  'systemSettings',
  'registration',
  'propertyEntry',
  'buildingUnit',
  'document',
  'feeNotice',
  'citizenPayment',
] as const;

type TableName = (typeof TABLE_ORDER)[number];

export interface SnapshotManifest {
  version: number;
  tenantSlug: string;
  createdAt: string;
  /** The tenant schema's applied migrations, newest last. */
  migrations: string[];
  counts: Record<string, number>;
}

interface Snapshot {
  manifest: SnapshotManifest;
  tables: Record<string, unknown[]>;
}

export interface RestoreReport {
  dryRun: boolean;
  manifest: SnapshotManifest;
  /** Rows deleted per table, then written per table. Empty on a dry run. */
  deleted: Record<string, number>;
  written: Record<string, number>;
}

/**
 * A tenant's data, out and back in.
 *
 * This is the restorable pair. The CSV archive the settings screen builds in
 * the browser is a *report* — it exports what the API returns (a joined
 * `fullName`, computed totals like `feesTotal`) and cannot be read back into
 * tables that want `firstName`/`middleName`/`lastName`, `gender` and
 * `familySize`. Both are worth having, and confusing them is how a
 * municipality discovers at the worst moment that its backups restore nothing.
 * This one reads and writes table rows.
 *
 * **Restore replaces.** It empties the tenant's tables and writes the
 * snapshot's rows in their place, inside one transaction — so it either lands
 * completely or not at all. Merging was the alternative and is worse: a
 * snapshot is a picture of a moment, and half-merging it into a schema that has
 * moved on produces a state that never existed, with no way to tell which rows
 * came from where. Replacement is at least a state the municipality once had.
 *
 * Three things gate it, and all three are checked before anything is written:
 * the snapshot's tenant must match the target, its migration set must match,
 * and the caller must name the tenant back. See `restore`.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly events: EventEmitter2,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  /** A Prisma delegate by table name, typed loosely because the list is data. */
  private delegate(table: TableName): {
    findMany: (args?: unknown) => Promise<unknown[]>;
    createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    deleteMany: (args?: unknown) => Promise<{ count: number }>;
    count: () => Promise<number>;
  } {
    const client = this.db as unknown as Record<string, unknown>;
    const found = client[table];
    if (!found) throw new Error(`Unknown table '${table}' in snapshot table order`);
    return found as ReturnType<BackupService['delegate']>;
  }

  /** The migrations this schema has applied, so a restore can refuse a mismatch. */
  private async appliedMigrations(): Promise<string[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT "name" FROM "_tenant_migrations" ORDER BY "name"',
    );
    return rows.map((row) => row.name);
  }

  /**
   * Every row of every table, gzipped.
   *
   * Gzipped JSON rather than a ZIP of CSVs: CSV has no types, so a boolean
   * comes back as the string `"true"` and a null as an empty cell
   * indistinguishable from an empty string — differences that matter the moment
   * the rows are written back. JSON keeps them, and `Date` survives as an ISO
   * string Prisma accepts on the way in. Gzip because a municipal register is
   * mostly repeated Arabic text and compresses to roughly a tenth.
   */
  async exportSnapshot(): Promise<{ buffer: Buffer; manifest: SnapshotManifest }> {
    const scope = this.tenantContext.require();

    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLE_ORDER) {
      const rows = await this.delegate(table).findMany();
      tables[table] = rows;
      counts[table] = rows.length;
    }

    const manifest: SnapshotManifest = {
      version: SNAPSHOT_VERSION,
      tenantSlug: scope.tenantSlug,
      createdAt: new Date().toISOString(),
      migrations: await this.appliedMigrations(),
      counts,
    };

    const snapshot: Snapshot = { manifest, tables };
    // `JSON.stringify` turns Decimal into its string form and Date into ISO,
    // both of which Prisma accepts back — no custom replacer needed.
    const buffer = gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));

    this.logger.log(
      `Exported ${scope.tenantSlug}: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, ${buffer.length} bytes`,
    );

    return { buffer, manifest };
  }

  /** Parses and validates a snapshot without touching the database. */
  private parse(gzipped: Buffer): Snapshot {
    let text: string;
    try {
      text = gunzipSync(gzipped).toString('utf8');
    } catch {
      throw new ValidationError('الملف ليس نسخة احتياطية صالحة (تعذّر فك الضغط).');
    }

    const ISO_DATE_REGEX =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(text, (_key, value) => {
        if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
          const date = new Date(value);
          if (!isNaN(date.getTime())) return date;
        }
        return value;
      }) as Snapshot;
    } catch {
      throw new ValidationError('محتوى النسخة الاحتياطية غير صالح.');
    }

    if (!snapshot?.manifest || !snapshot.tables) {
      throw new ValidationError('النسخة الاحتياطية لا تحتوي على بيان أو جداول.');
    }
    if (snapshot.manifest.version !== SNAPSHOT_VERSION) {
      throw new ValidationError(
        `إصدار النسخة (${snapshot.manifest.version}) لا يطابق الإصدار المدعوم (${SNAPSHOT_VERSION}).`,
      );
    }

    return snapshot;
  }

  /**
   * Writes a snapshot back over this tenant's data.
   *
   * @param confirmTenantSlug the tenant slug, typed by the operator. Not
   *   security — the route is already SUPER_ADMIN and tenant-scoped — but the
   *   one confirmation muscle memory cannot dismiss, matching how this codebase
   *   already guards deleting a citizen.
   * @param dryRun validates everything and reports what *would* happen. The
   *   default from the UI, because "restore" is a word people click before they
   *   have read the sentence next to it.
   */
  async restore(
    gzipped: Buffer,
    options: { confirmTenantSlug: string; dryRun: boolean },
    actor: { id: string; role: string },
  ): Promise<RestoreReport> {
    const scope = this.tenantContext.require();
    const snapshot = this.parse(gzipped);
    const manifest = snapshot.manifest;

    /*
     * The three gates, all before any write.
     *
     * The tenant check is the one that matters most: an
     * `albazourieh-backup.zip` restored into Zahle looks like a backup either
     * way from its file name, and the result is one municipality's register
     * replaced by another's.
     */
    if (manifest.tenantSlug !== scope.tenantSlug) {
      throw new ValidationError(
        `هذه النسخة تخصّ «${manifest.tenantSlug}» ولا يمكن استعادتها في «${scope.tenantSlug}».`,
      );
    }

    if (options.confirmTenantSlug.trim() !== scope.tenantSlug) {
      throw new ValidationError('اكتب اسم البلدية كما هو للتأكيد.');
    }

    /*
     * A snapshot taken before a migration has columns the current schema does
     * not, or is missing ones it now requires. Prisma would reject the row and
     * abort — correctly, but with an error about one column rather than about
     * the real problem, so it is caught here where it can be explained.
     */
    const current = await this.appliedMigrations();
    const missing = current.filter((name) => !manifest.migrations.includes(name));
    const extra = manifest.migrations.filter((name) => !current.includes(name));
    if (missing.length > 0 || extra.length > 0) {
      throw new ValidationError(
        `النسخة أُخذت من قاعدة بإصدار مختلف (فرق: ${[...missing, ...extra].join('، ')}).`,
      );
    }

    const unknownTables = Object.keys(snapshot.tables).filter(
      (name) => !TABLE_ORDER.includes(name as TableName),
    );
    if (unknownTables.length > 0) {
      throw new ValidationError(`جداول غير معروفة في النسخة: ${unknownTables.join('، ')}.`);
    }

    const MUTABLE_TABLES: readonly TableName[] = [
      'user',
      'otpChallenge',
      'parcel',
      'zone',
      'systemSettings',
      'registration',
      'propertyEntry',
      'buildingUnit',
      'document',
      'feeNotice',
      'citizenPayment',
    ];

    if (options.dryRun) {
      const deleted: Record<string, number> = {};
      for (const table of MUTABLE_TABLES) deleted[table] = await this.delegate(table).count();
      return {
        dryRun: true,
        manifest,
        deleted,
        written: Object.fromEntries(
          MUTABLE_TABLES.map((table) => [table, snapshot.tables[table]?.length ?? 0]),
        ),
      };
    }

    const deleted: Record<string, number> = {};
    const written: Record<string, number> = {};

    const DECIMAL_FIELDS: Record<string, string[]> = {
      propertyEntry: ['unitArea'],
      buildingUnit: ['unitArea'],
      systemSettings: ['defaultRatePercent', 'exchangeRate'],
      feeNotice: ['amount', 'paidAmount'],
      citizenPayment: ['amount'],
    };

    const ISO_DATE_REGEX =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

    /*
     * One interactive transaction for the whole thing.
     *
     * Half a restore is worse than none — a register missing its payments but
     * holding its citizens is a state no municipality ever had and nothing can
     * reconcile. The timeout is generous because this is the one operation on
     * this system where taking too long is preferable to giving up midway; the
     * transaction still rolls back cleanly if it is exceeded.
     */
    try {
      await this.db.$transaction(
        async (tx) => {
          const client = tx as unknown as Record<string, unknown>;
          const executeRaw = (query: string) =>
            (client['$executeRawUnsafe'] as (q: string) => Promise<number>)(query);

          // Temporarily disable user-defined append-only triggers for the duration of the full restore
          await executeRaw(`ALTER TABLE "payment_transactions" DISABLE TRIGGER USER;`);
          await executeRaw(`ALTER TABLE "audit_log_entries" DISABLE TRIGGER USER;`);
          await executeRaw(`DELETE FROM "payment_transactions";`);

          const scoped = (table: TableName) => {
            return client[table] as ReturnType<BackupService['delegate']>;
          };

          // Backwards: a child's rows go before the parent they point at.
          for (const table of [...MUTABLE_TABLES].reverse()) {
            const result = await scoped(table).deleteMany({});
            deleted[table] = result.count;
          }

          for (const table of MUTABLE_TABLES) {
            const rawRows = (snapshot.tables[table] ?? []) as Array<Record<string, unknown>>;
            if (rawRows.length === 0) {
              written[table] = 0;
              continue;
            }

            const decimalCols = DECIMAL_FIELDS[table] || [];
            const sanitizedRows = rawRows.map((row) => {
              const clean: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                if (v === null || v === undefined) {
                  clean[k] = v;
                } else if (
                  decimalCols.includes(k) &&
                  (typeof v === 'string' || typeof v === 'number')
                ) {
                  clean[k] = new Prisma.Decimal(v);
                } else if (typeof v === 'string' && ISO_DATE_REGEX.test(v)) {
                  clean[k] = new Date(v);
                } else {
                  clean[k] = v;
                }
              }
              return clean;
            });

            // `createMany` in one call per table rather than a row at a time:
            // a register of ten thousand citizens is ten thousand round trips
            // otherwise, inside a transaction holding locks the whole while.
            const result = await scoped(table).createMany({ data: sanitizedRows });
            written[table] = result.count;
          }

          // Re-enable triggers once all tables are restored
          await executeRaw(`ALTER TABLE "payment_transactions" ENABLE TRIGGER USER;`);
          await executeRaw(`ALTER TABLE "audit_log_entries" ENABLE TRIGGER USER;`);
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
    } catch (txError: unknown) {
      this.logger.error('Restore transaction failed: ', txError);
      throw new ValidationError(
        txError instanceof Error ? `فشلت الاستعادة: ${txError.message}` : 'تعذّرت استعادة البيانات.',
      );
    }

    this.logger.warn(
      `Restored ${scope.tenantSlug} from snapshot of ${manifest.createdAt} by ${actor.id}`,
    );

    this.events.emit('backup.restored', {
      tenantSlug: scope.tenantSlug,
      actorId: actor.id,
      actorRole: actor.role,
      snapshotCreatedAt: manifest.createdAt,
      written,
    });

    return { dryRun: false, manifest, deleted, written };
  }
}
