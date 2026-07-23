import { Inject, Injectable } from '@nestjs/common';
import {
  REGISTRATION_REPOSITORY,
  RegistrationRepository,
} from '../domain/registration.repository';

/** Backs the blur-check as the citizen types رقم العقار in Step 3–4. */
@Injectable()
export class CheckPropertyNumberUseCase {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly registrations: RegistrationRepository,
  ) {}

  async execute(tenantId: string, propertyNumber: string) {
    const available = await this.registrations.isPropertyNumberAvailable(
      tenantId,
      propertyNumber.trim(),
    );
    return { propertyNumber: propertyNumber.trim(), available };
  }
}
