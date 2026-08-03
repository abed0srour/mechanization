import { Controller, Get, Param } from '@nestjs/common';
import { RegistrationService } from '../../application/features/registration/registration.service';
import { Public } from '../decorators/public.decorator';

/**
 * What survives of the طلبات API: the cadastre lookup.
 *
 * This controller used to carry the whole citizen-facing lifecycle — a public
 * multipart `POST` for the six-step wizard, `GET mine` and `by-reference` for
 * tracking, the correction round-trip, the staff review queue, and
 * `PATCH :id/status` for the decision itself. Records are now entered by staff
 * (see `CitizenController`), so none of those have a caller.
 *
 * The property-number check is not part of that workflow and stays: it asks
 * the *cadastre* whether a رقم العقار is real, which the staff entry form
 * calls on every keystroke.
 *
 * The route path is unchanged so the form's existing call keeps working. It
 * reads oddly under `/registrations` now — moving it to `/cadastre` would be
 * the tidier home, at the cost of a coordinated client change for no
 * behavioural gain.
 */
@Controller('t/:tenantSlug/registrations')
export class RegistrationController {
  constructor(private readonly registrations: RegistrationService) {}

  /**
   * Live check while a رقم العقار is typed: is it a real parcel, and how many
   * neighbours are already registered on it.
   *
   * Public because it reveals nothing personal — it answers a question about
   * the municipality's own cadastre, which is a public register.
   */
  @Public()
  @Get('property-number/:propertyNumber/availability')
  async checkPropertyNumber(@Param('propertyNumber') propertyNumber: string) {
    return this.registrations.checkPropertyNumber(propertyNumber);
  }
}
