import { Injectable } from '@nestjs/common';
import {
  OtpChallengeRow,
  OtpChannel,
  OtpRepository,
} from '../../domain/interfaces/otp-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';

/**
 * OTP state lives in Postgres rather than Redis.
 *
 * v1 reached for Redis partly for rate-limit counters; a challenge table the
 * login flow already has to write is enough, and it removes an entire service
 * whose loss would have taken citizen login down with it.
 */
@Injectable()
export class PrismaOtpRepository implements OtpRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async create(input: {
    phone: string;
    codeHash: string;
    channel: OtpChannel;
    expiresAt: Date;
  }): Promise<string> {
    // Any earlier live challenge is burned: two valid codes for one phone
    // doubles the guess surface for no benefit to the citizen.
    await this.db.otpChallenge.updateMany({
      where: { phone: input.phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const row = await this.db.otpChallenge.create({
      data: {
        phone: input.phone,
        codeHash: input.codeHash,
        channel: input.channel,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });

    return row.id;
  }

  async findActive(phone: string): Promise<OtpChallengeRow | null> {
    const row = await this.db.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;

    return {
      id: row.id,
      phone: row.phone,
      codeHash: row.codeHash,
      channel: row.channel as OtpChannel,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
    };
  }

  async incrementAttempts(id: string): Promise<number> {
    const row = await this.db.otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return row.attempts;
  }

  async consume(id: string): Promise<void> {
    await this.db.otpChallenge.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }

  async countRecent(phone: string, since: Date): Promise<number> {
    return this.db.otpChallenge.count({
      where: { phone, createdAt: { gte: since } },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.db.otpChallenge.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return result.count;
  }
}
