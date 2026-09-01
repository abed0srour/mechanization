import { Injectable } from '@nestjs/common';
import type { CreateExpense, UpdateExpense } from '@mechanization/shared-schemas';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';
import { NotFoundError } from '../../common/exceptions';

/**
 * Money the municipality spends. The mirror of `FeesService`, which handles
 * money it receives — deliberately simpler, since an expense has no citizen
 * facing it, no recurrence engine and no payment gateway: a clerk records
 * what was spent, and can correct or archive the record afterwards.
 */
@Injectable()
export class ExpensesService {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  private serialize(row: {
    id: string;
    category: string;
    description: string;
    amount: unknown;
    currency: string;
    expenseDate: Date;
    payee: string | null;
    paymentMethod: string;
    reference: string | null;
    notes: string | null;
    createdById: string | null;
    createdBy: { firstName: string; lastName: string } | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: row.id,
      category: row.category,
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      expenseDate: row.expenseDate,
      payee: row.payee,
      paymentMethod: row.paymentMethod,
      reference: row.reference,
      notes: row.notes,
      createdById: row.createdById,
      createdByName: row.createdBy
        ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim()
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archived: row.deletedAt !== null,
    };
  }

  async list(
    filter: {
      category?: string;
      search?: string;
      archived?: boolean;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const take = Math.min(Math.max(filter.limit ?? 25, 1), 200);
    const skip = Math.max(filter.offset ?? 0, 0);

    const search = filter.search?.trim();

    const where = {
      deletedAt: filter.archived ? { not: null } : null,
      ...(filter.category ? { category: filter.category as never } : {}),
      ...(filter.from || filter.to
        ? {
            expenseDate: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              // Bumped to end-of-day so a range ending "today" includes today.
              ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999`) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' as const } },
              { payee: { contains: search, mode: 'insensitive' as const } },
              { reference: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await withConnectionRetry(() =>
      this.db.$transaction([
        this.db.expense.findMany({
          where,
          include: { createdBy: { select: { firstName: true, lastName: true } } },
          orderBy: { expenseDate: 'desc' },
          take,
          skip,
        }),
        this.db.expense.count({ where }),
      ]),
    );

    return { items: rows.map((row) => this.serialize(row)), total };
  }

  async getById(id: string) {
    const row = await withConnectionRetry(() =>
      this.db.expense.findUnique({
        where: { id },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      }),
    );
    if (!row) throw new NotFoundError('المصروف غير موجود');
    return this.serialize(row);
  }

  /**
   * Totals for the reporting window, defaulting to the trailing year — long
   * enough to show a seasonal pattern (a winter fuel spike) without the
   * client having to know that up front.
   */
  async summary(from?: string, to?: string) {
    const rangeEnd = to ? new Date(`${to}T23:59:59.999`) : new Date();
    const rangeStart = from ? new Date(from) : new Date(rangeEnd.getTime() - 365 * 86_400_000);

    const where = {
      deletedAt: null,
      expenseDate: { gte: rangeStart, lte: rangeEnd },
    };

    const [rows, byCategory] = await withConnectionRetry(() =>
      this.db.$transaction([
        this.db.expense.findMany({
          where,
          select: { amount: true, expenseDate: true },
        }),
        this.db.expense.groupBy({
          by: ['category'],
          where,
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]),
    );

    // Bucketed in code rather than a second groupBy: Postgres has no
    // to_char-by-month grouping through Prisma's query builder, and the row
    // count in one municipality's expense ledger is small enough that
    // folding it here costs nothing.
    const byMonth = new Map<string, number>();
    let total = 0;
    for (const row of rows) {
      const amount = Number(row.amount);
      total += amount;
      const month = row.expenseDate.toISOString().slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
    }

    return {
      total,
      byCategory: byCategory
        .map((entry) => ({
          category: entry.category,
          count: entry._count._all,
          total: Number(entry._sum.amount ?? 0),
        }))
        .sort((a, b) => b.total - a.total),
      byMonth: Array.from(byMonth.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, amount })),
    };
  }

  async create(input: CreateExpense, actor: { id: string }) {
    const row = await withConnectionRetry(() =>
      this.db.expense.create({
        data: {
          category: input.category,
          description: input.description,
          amount: input.amount,
          currency: input.currency,
          expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
          payee: input.payee || null,
          paymentMethod: input.paymentMethod,
          reference: input.reference || null,
          notes: input.notes || null,
          createdById: actor.id,
        },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      }),
    );
    return this.serialize(row);
  }

  async update(id: string, input: UpdateExpense) {
    await this.assertExists(id);

    const row = await withConnectionRetry(() =>
      this.db.expense.update({
        where: { id },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.expenseDate !== undefined ? { expenseDate: new Date(input.expenseDate) } : {}),
          ...(input.payee !== undefined ? { payee: input.payee || null } : {}),
          ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
          ...(input.reference !== undefined ? { reference: input.reference || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      }),
    );
    return this.serialize(row);
  }

  /**
   * Archives rather than deletes — an expense is a fiscal fact, and a report
   * run over last quarter must not silently lose a row someone removed since.
   * Reversible via `restore`.
   */
  async archive(id: string) {
    await this.assertExists(id);
    await withConnectionRetry(() =>
      this.db.expense.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    return { success: true };
  }

  async restore(id: string) {
    const existing = await this.assertExists(id);
    if (existing.deletedAt === null) return { success: true, alreadyActive: true };

    await withConnectionRetry(() =>
      this.db.expense.update({ where: { id }, data: { deletedAt: null } }),
    );
    return { success: true, alreadyActive: false };
  }

  private async assertExists(id: string) {
    const row = await withConnectionRetry(() =>
      this.db.expense.findUnique({ where: { id }, select: { deletedAt: true } }),
    );
    if (!row) throw new NotFoundError('المصروف غير موجود');
    return row;
  }
}
