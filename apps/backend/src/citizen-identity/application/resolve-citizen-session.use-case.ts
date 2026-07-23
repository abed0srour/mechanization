import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../shared-kernel/domain/errors';
import {
  CITIZEN_PROFILE_REPOSITORY,
  CitizenProfileRepository,
} from '../domain/citizen-profile.repository';

@Injectable()
export class ResolveCitizenSessionUseCase {
  constructor(
    @Inject(CITIZEN_PROFILE_REPOSITORY)
    private readonly profiles: CitizenProfileRepository,
  ) {}

  /**
   * One phone often serves a whole household, so a verified number can map to
   * several registered people. Rather than guessing or merging them, the client
   * shows a picker and calls `select` with the chosen profile.
   */
  async execute(tenantId: string, phone: string) {
    const profiles = await this.profiles.findByPhone(tenantId, phone);

    if (profiles.length === 0) {
      throw new NotFoundError('No registration found for this phone number');
    }

    return {
      profiles,
      requiresSelection: profiles.length > 1,
    };
  }

  async select(tenantId: string, citizenId: string, supabaseUserId: string) {
    const profile = await this.profiles.findById(tenantId, citizenId);
    if (!profile) throw new NotFoundError('Citizen profile', citizenId);

    await this.profiles.linkSupabaseUser(tenantId, citizenId, supabaseUserId);
    return profile;
  }
}
