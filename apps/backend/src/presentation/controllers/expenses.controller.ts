import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createExpenseSchema,
  updateExpenseSchema,
  type CreateExpense,
  type UpdateExpense,
} from '@mechanization/shared-schemas';
import { ExpensesService } from '../../application/features/expenses/expenses.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * Municipal expenses — money the municipality spends, the mirror of
 * `FeesController`. AUDITOR reads the books; only SUPER_ADMIN and ACCOUNTANT
 * write to them, same split as every other financial mutation in this app.
 */
@Controller('t/:tenantSlug/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Roles('SUPER_ADMIN', 'AUDITOR', 'ACCOUNTANT')
  @Get()
  async list(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('archived') archived?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.expenses.list({
      category,
      search,
      archived: archived === 'true',
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Roles('SUPER_ADMIN', 'AUDITOR', 'ACCOUNTANT')
  @Get('summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.expenses.summary(from, to);
  }

  /** Registered ahead of `:id` — see `FeesController.getPayment` for why order matters here. */
  @Roles('SUPER_ADMIN', 'AUDITOR', 'ACCOUNTANT')
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.expenses.getById(id);
  }

  @Roles('SUPER_ADMIN', 'ACCOUNTANT')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpense,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.expenses.create(body, { id: user.sub });
  }

  @Roles('SUPER_ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) body: UpdateExpense,
  ) {
    return this.expenses.update(id, body);
  }

  @Roles('SUPER_ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  async archive(@Param('id') id: string) {
    return this.expenses.archive(id);
  }

  @Roles('SUPER_ADMIN', 'ACCOUNTANT')
  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    return this.expenses.restore(id);
  }
}
