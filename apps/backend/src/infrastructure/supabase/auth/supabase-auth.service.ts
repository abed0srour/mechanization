import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import {
  SupabaseAuthResult,
  SupabaseAuthService,
  SupabaseAuthUser,
} from '../../../domain/interfaces/supabase-auth.interface';
import { UnauthorizedError } from '../../../application/common/exceptions';

@Injectable()
export class SupabaseAuthServiceImpl implements SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthServiceImpl.name);
  private readonly client: SupabaseClient;

  constructor(config: ConfigService) {
    this.client = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  async authenticateStaff(email: string, password: string): Promise<SupabaseAuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error || !data.user || !data.session) {
      this.logger.warn(`Supabase staff auth failed for ${email}: ${error?.message}`);
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        userMetadata: data.user.user_metadata,
        appMetadata: data.user.app_metadata,
      },
      accessToken: data.session.access_token,
      expiresIn: data.session.expires_in?.toString(),
    };
  }

  async createStaffUser(input: {
    email: string;
    password: string;
    tenantSlug: string;
    role: string;
    firstName: string;
    lastName: string;
  }): Promise<{ id: string }> {
    const email = input.email.trim().toLowerCase();
    const metadata = {
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      tenantSlug: input.tenantSlug,
    };

    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error) {
      if (error.message.toLowerCase().includes('already') || error.status === 422) {
        // User already exists in Supabase Auth — update their credentials and metadata
        const existing = await this.findUserByEmail(email);
        if (existing) {
          const { error: updateError } = await this.client.auth.admin.updateUserById(existing.id, {
            password: input.password,
            user_metadata: metadata,
          });
          if (updateError) {
            this.logger.error(`Failed to update existing Supabase user ${email}: ${updateError.message}`);
          }
          return { id: existing.id };
        }
      }
      this.logger.error(`Supabase createUser failed for ${email}: ${error.message}`);
      throw new Error(`Failed to provision Supabase user: ${error.message}`);
    }

    return { id: data.user.id };
  }

  async updateStaffUser(input: {
    email: string;
    newEmail?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<void> {
    const existing = await this.findUserByEmail(input.email);
    if (!existing) {
      this.logger.warn(`Supabase user not found for update: ${input.email}`);
      return;
    }

    const updates: Parameters<typeof this.client.auth.admin.updateUserById>[1] = {};
    if (input.newEmail) {
      updates.email = input.newEmail.trim().toLowerCase();
      updates.email_confirm = true;
    }
    if (input.password) {
      updates.password = input.password;
    }

    const userMetadata: Record<string, unknown> = {
      ...(existing.user_metadata || {}),
    };
    if (input.firstName) userMetadata.firstName = input.firstName;
    if (input.lastName) userMetadata.lastName = input.lastName;
    if (input.role) userMetadata.role = input.role;
    if (input.isActive !== undefined) userMetadata.isActive = input.isActive;
    updates.user_metadata = userMetadata;

    if (input.isActive === false) {
      // 100 years ban duration for deactivated accounts
      updates.ban_duration = '876000h';
    } else if (input.isActive === true) {
      updates.ban_duration = 'none';
    }

    const { error } = await this.client.auth.admin.updateUserById(existing.id, updates);
    if (error) {
      this.logger.error(`Failed to update Supabase user ${input.email}: ${error.message}`);
    }
  }

  async deleteStaffUser(email: string): Promise<void> {
    const existing = await this.findUserByEmail(email);
    if (!existing) return;

    const { error } = await this.client.auth.admin.deleteUser(existing.id);
    if (error) {
      this.logger.error(`Failed to delete Supabase user ${email}: ${error.message}`);
    }
  }

  async verifyToken(token: string): Promise<SupabaseAuthUser | null> {
    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data.user) {
        return null;
      }
      return {
        id: data.user.id,
        email: data.user.email,
        userMetadata: data.user.user_metadata,
        appMetadata: data.user.app_metadata,
      };
    } catch {
      return null;
    }
  }

  private async findUserByEmail(email: string) {
    const normalised = email.trim().toLowerCase();
    const { data, error } = await this.client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error || !data?.users) {
      this.logger.error(`Failed to list Supabase users: ${error?.message}`);
      return null;
    }
    return data.users.find((u) => u.email?.toLowerCase() === normalised) ?? null;
  }
}
