/** Framework-free representation of a municipality. */
export interface TenantConfig {
  logoUrl?: string;
  primaryColor?: string;
  enabledPropertyTypes?: string[];
  requiredDocuments?: string[];
  contactPhone?: string;
}

export class Tenant {
  private constructor(
    readonly id: string,
    readonly slug: string,
    readonly name: string,
    readonly nameAr: string,
    readonly adminPathSegment: string,
    readonly isActive: boolean,
    readonly config: TenantConfig,
  ) {}

  static rehydrate(props: {
    id: string;
    slug: string;
    name: string;
    nameAr: string;
    adminPathSegment: string;
    isActive: boolean;
    config: unknown;
  }): Tenant {
    return new Tenant(
      props.id,
      props.slug,
      props.name,
      props.nameAr,
      props.adminPathSegment,
      props.isActive,
      (props.config as TenantConfig) ?? {},
    );
  }

  /** Reference numbers are prefixed per municipality so they read distinctly. */
  get referencePrefix(): string {
    return this.slug.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase();
  }

  allowsPropertyType(type: string): boolean {
    const enabled = this.config.enabledPropertyTypes;
    return !enabled || enabled.length === 0 || enabled.includes(type);
  }
}
