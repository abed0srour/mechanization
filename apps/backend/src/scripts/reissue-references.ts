/**
 * Reissues every citizen رقم مرجعي in a municipality, using the CSPRNG.
 *
 *   pnpm reissue-references --slug albazourieh --dry-run
 *   pnpm reissue-references --slug albazourieh --confirm albazourieh
 *
 * Every reference minted before the fix in `ReferenceNumber.generate` came from
 * `Math.random()` — V8's xorshift128+, whose internal state is recoverable from
 * a handful of observed outputs. References are printed on receipts and read
 * aloud at the counter, so outputs are public; and `POST
 * /auth/citizen/reference/open` accepts one alone as a credential. Swapping the
 * generator protects references minted from now on and does nothing for the
 * ones already issued, which is what this is for.
 *
 * **This invalidates printed receipts.** A citizen holding a وصل with an old
 * reference will find it no longer signs them in, and the municipality has to
 * tell them their new one. That is the cost of the fix; carrying on with
 * predictable credentials is the alternative. Run it once, deliberately, and
 * plan the announcement first.
 *
 * `--dry-run` is the default. The destructive form needs the slug typed back,
 * matching how `BackupService.restore` guards the same class of act.
 */
import { PrismaClient as RegistryPrismaClient } from '../generated/registry-client';
import { PrismaClient as TenantPrismaClient } from '../generated/tenant-client';
import { ReferenceNumber } from '../domain/value-objects/reference-number.vo';
import { TenantSlug } from '../domain/value-objects/tenant-slug.vo';

interface Args {
  slug: string;
  confirm?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const slug = get('--slug');
  if (!slug) {
    throw new Error('Usage: reissue-references --slug <slug> [--confirm <slug>] [--dry-run]');
  }

  const confirm = get('--confirm');
  return { slug, confirm, dryRun: !confirm || argv.includes('--dry-run') };
}

function tenantClient(schemaName: string): TenantPrismaClient {
  const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);
  url.searchParams.set('schema', schemaName);
  return new TenantPrismaClient({ datasources: { db: { url: url.toString() } } });
}

export async function reissueReferences(args: Args): Promise<void> {
  const slug = TenantSlug.parse(args.slug);
  const registry = new RegistryPrismaClient();

  try {
    const tenant = await registry.tenant.findUnique({ where: { slug: slug.value } });
    if (!tenant) throw new Error(`No municipality '${slug.value}'`);

    if (!args.dryRun && args.confirm?.trim() !== slug.value) {
      throw new Error(`Type the slug back to confirm: --confirm ${slug.value}`);
    }

    const db = tenantClient(tenant.schemaName);

    try {
      const citizens = await db.user.findMany({
        where: { kind: 'CITIZEN', referenceNumber: { not: null } },
        select: { id: true, firstName: true, lastName: true, referenceNumber: true, phone: true },
        orderBy: { createdAt: 'asc' },
      });

      console.log(
        `${args.dryRun ? '[dry run] ' : ''}${citizens.length} citizen reference(s) in '${slug.value}'`,
      );

      if (args.dryRun) {
        console.log('\nNothing written. Re-run with --confirm <slug> to reissue.');
        console.log('Export the old→new mapping from the real run — it is the only');
        console.log('record of which citizen to notify, and it is not kept anywhere else.');
        return;
      }

      /**
       * Taken in one pass, and collision-checked against the column's unique
       * index rather than against a set held here: two runs, or a citizen
       * created while this is running, share the same namespace. A retry on
       * conflict is cheaper and more honest than pre-reserving the space.
       */
      let reissued = 0;
      console.log('\nold,new,name,phone');

      for (const citizen of citizens) {
        const previous = citizen.referenceNumber!;
        let applied: string | null = null;

        for (let attempt = 0; attempt < 5 && !applied; attempt += 1) {
          const candidate = ReferenceNumber.generate(tenant.referencePrefix).value;
          try {
            await db.user.update({
              where: { id: citizen.id },
              data: { referenceNumber: candidate },
            });
            applied = candidate;
          } catch {
            // Unique violation — 32⁶ makes this vanishingly rare, so a handful
            // of attempts is plenty and a failure after them is a real fault.
          }
        }

        if (!applied) {
          throw new Error(`Could not find a free reference for citizen ${citizen.id}`);
        }

        // CSV on stdout so the run can be redirected to the file the
        // municipality works from when it notifies people.
        console.log(
          [previous, applied, `${citizen.firstName} ${citizen.lastName}`, citizen.phone ?? '']
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
            .join(','),
        );
        reissued += 1;
      }

      console.error(`\n✓ Reissued ${reissued} reference(s) in '${slug.value}'`);
      console.error('  Every previously printed receipt no longer signs its holder in.');
    } finally {
      await db.$disconnect();
    }
  } finally {
    await registry.$disconnect();
  }
}

if (require.main === module) {
  reissueReferences(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
