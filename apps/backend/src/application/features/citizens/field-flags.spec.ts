import {
  adminCreateCitizenSubmissionSchema,
  isFlaggablePath,
  statusForFlags,
} from '@mechanization/shared-schemas';

/**
 * «غير مؤكَّد» — what a flag may and may not excuse.
 *
 * These run against the *same schema object* the controller's validation pipe
 * uses and the browser form validates with, so what they pin down is the one
 * contract all three share. That matters more than usual here: a record filed
 * offline is validated in a browser hours before any server sees it, and a
 * browser that accepted something the server would refuse would queue a
 * registration that fails on arrival — in a settlement nobody is going back to.
 */
const complete = () => ({
  personal: {
    firstName: 'علي',
    middleName: 'حسن',
    lastName: 'نصرالله',
    gender: 'MALE',
    bloodType: 'O_POSITIVE',
    identityDocType: 'NATIONAL_ID',
    identityDocNumber: '12345',
    civilRecordNumber: '7',
    nationality: 'لبناني',
    isLebanese: true,
    residentStatus: 'VILLAGE_RESIDENT',
  } as Record<string, unknown>,
  contact: {
    maritalStatus: 'MARRIED',
    phone: '03 123456',
    whatsappSameAsPhone: true,
    familySize: '4',
  } as Record<string, unknown>,
  properties: [
    {
      occupancyType: 'OWNER',
      propertyType: 'LAND',
      neighborhood: 'الحي الشرقي',
      propertyNumber: '1553',
      landType: 'AGRICULTURAL',
      unitArea: '250',
    } as Record<string, unknown>,
  ],
  flags: [] as Array<{ path: string; reason: string }>,
});

/** The dot-paths a failed parse complained about. */
const failures = (input: unknown): string[] => {
  const result = adminCreateCitizenSubmissionSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('citizen submission — no flags', () => {
  it('accepts a complete record and normalises it', () => {
    const result = adminCreateCitizenSubmissionSchema.safeParse(complete());

    expect(result.success).toBe(true);
    if (!result.success) return;

    // The strict schema's own coercions still happen on the flag-aware path.
    expect(result.data.contact.phone).toBe('+9613123456');
    expect(result.data.contact.familySize).toBe(4);
    expect(result.data.properties[0]?.unitArea).toBe(250);
  });

  it('is exactly as strict as it ever was', () => {
    const input = complete();
    delete input.personal.civilRecordNumber;

    expect(failures(input)).toEqual(['personal.civilRecordNumber']);
  });
});

describe('citizen submission — a flag excuses one field', () => {
  it('accepts a missing field the officer flagged, with the reason', () => {
    const input = complete();
    delete input.personal.civilRecordNumber;
    input.flags = [
      { path: 'personal.civilRecordNumber', reason: 'إخراج القيد عند الأخ في بيروت' },
    ];

    const result = adminCreateCitizenSubmissionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.personal.civilRecordNumber).toBeUndefined();
    expect(statusForFlags(result.data.flags)).toBe('REQUIRES_REVIEW');
  });

  it('does not excuse the field next to it', () => {
    const input = complete();
    delete input.personal.civilRecordNumber;
    delete input.personal.bloodType;
    input.flags = [{ path: 'personal.civilRecordNumber', reason: 'إخراج القيد عند الأخ' }];

    expect(failures(input)).toEqual(['personal.bloodType']);
  });

  it('does not excuse the same field on a different property card', () => {
    const input = complete();
    input.properties = [
      { ...input.properties[0] },
      { ...input.properties[0], propertyNumber: '1554' },
    ];
    delete input.properties[0]!.unitArea;
    delete input.properties[1]!.unitArea;
    input.flags = [{ path: 'properties.0.unitArea', reason: 'الأرض غير ممسوحة' }];

    expect(failures(input)).toEqual(['properties.1.unitArea']);
  });

  it('discards a value the officer flagged rather than storing it', () => {
    // The officer typed a guess, then flagged the field. The guess must not
    // survive: the record says this was never established.
    const input = complete();
    input.properties[0]!.propertyNumber = '9999';
    input.flags = [{ path: 'properties.0.propertyNumber', reason: 'السند عند الورثة' }];

    const result = adminCreateCitizenSubmissionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.properties[0]?.propertyNumber).toBeUndefined();
  });

  it('requires a reason worth reading', () => {
    const input = complete();
    delete input.personal.civilRecordNumber;
    input.flags = [{ path: 'personal.civilRecordNumber', reason: '' }];

    expect(failures(input)).toEqual(['flags.0.reason']);
  });

  it('refuses a flag on a field the record cannot do without', () => {
    const input = complete();
    delete input.personal.lastName;
    input.flags = [{ path: 'personal.lastName', reason: 'لم يُذكر' }];

    // Refused as a flag, not merely ignored — an officer who is told "flagged"
    // and then finds the save rejected on الشهرة has been misled twice.
    expect(failures(input)).toEqual(['flags.0.path']);
    expect(isFlaggablePath('personal.lastName')).toBe(false);
    expect(isFlaggablePath('properties.0.propertyType')).toBe(false);
    expect(isFlaggablePath('properties.0.propertyNumber')).toBe(true);
  });

  it('refuses the same field flagged twice', () => {
    const input = complete();
    delete input.personal.civilRecordNumber;
    input.flags = [
      { path: 'personal.civilRecordNumber', reason: 'سبب أول' },
      { path: 'personal.civilRecordNumber', reason: 'سبب ثانٍ' },
    ];

    expect(failures(input)).toEqual(['flags.1.path']);
  });
});

describe('citizen submission — cross-field rules', () => {
  it('still refuses a tent for someone who is not a refugee', () => {
    const input = complete();
    input.properties = [
      {
        occupancyType: 'OWNER',
        propertyType: 'TENT',
        neighborhood: 'المخيم',
        propertyNumber: '9',
        tentLocation: 'قطعة ٤ شمال',
      },
    ];

    expect(failures(input)).toEqual(['properties.0.propertyType']);
  });

  it('allows the tent once صفة الإقامة itself is what could not be established', () => {
    // Refusing here would turn a flag on one field into a rejection of another.
    const input = complete();
    delete input.personal.residentStatus;
    input.properties = [
      {
        occupancyType: 'OWNER',
        propertyType: 'TENT',
        neighborhood: 'المخيم',
        propertyNumber: '9',
        tentLocation: 'قطعة ٤ شمال',
      },
    ];
    input.flags = [{ path: 'personal.residentStatus', reason: 'لا وثائق إقامة اليوم' }];

    expect(failures(input)).toEqual([]);
  });

  it('keeps a household with no phone reachable by nothing, and says so', () => {
    const input = complete();
    delete input.contact.phone;
    input.flags = [{ path: 'contact.phone', reason: 'الأسرة بلا هاتف' }];

    const result = adminCreateCitizenSubmissionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // `whatsappSameAsPhone` is still true, and there is nothing to copy — so
    // both come back empty rather than one of them inventing the other.
    expect(result.data.contact.phone).toBeUndefined();
    expect(result.data.contact.whatsapp).toBeUndefined();
  });
});

describe('citizen submission — offline delivery', () => {
  it('carries the browser id that makes a retry safe to repeat', () => {
    const result = adminCreateCitizenSubmissionSchema.safeParse({
      ...complete(),
      clientSubmissionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.clientSubmissionId).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('leaves a record with nothing flagged as an ordinary registration', () => {
    const result = adminCreateCitizenSubmissionSchema.safeParse(complete());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(statusForFlags(result.data.flags)).toBe('PENDING');
  });
});
