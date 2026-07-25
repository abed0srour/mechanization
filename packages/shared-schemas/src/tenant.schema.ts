import { z } from 'zod';
import { documentTypeSchema, propertyTypeSchema } from './enums';

/**
 * Shape of the `config` JSON column on the registry `Tenant` row.
 *
 * Validated rather than trusted: it is hand-edited per municipality, and a typo
 * in `enabledPropertyTypes` would otherwise silently reject every submission of
 * a type the municipality believes it accepts.
 */
export const tenantConfigSchema = z.object({
  enabledPropertyTypes: z.array(propertyTypeSchema).optional(),
  requiredDocuments: z.array(documentTypeSchema).optional(),
  branding: z
    .object({
      logoUrl: z.string().url().optional(),
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour')
        .optional(),
      accentColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour')
        .optional(),
    })
    .optional(),
  supportPhone: z.string().optional(),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;

/** What `/t/:slug/tenant/config` returns to the public wizard. */
export const publicTenantConfigSchema = z.object({
  slug: z.string(),
  name: z.string(),
  nameAr: z.string(),
  enabledPropertyTypes: z.array(propertyTypeSchema),
  requiredDocuments: z.array(z.string()),
  branding: z.object({
    logoUrl: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
  }),
  supportPhone: z.string().optional(),
});

export type PublicTenantConfig = z.infer<typeof publicTenantConfigSchema>;
