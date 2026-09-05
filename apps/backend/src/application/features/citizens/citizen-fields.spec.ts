import {
  adminCreateCitizenSubmissionSchema,
  contactDetailsSchema,
  contactPhone,
  lebaneseMobile,
  personalDetailsSchema,
  residentCountOf,
} from '@mechanization/shared-schemas';

/**
 * The fields added so nobody has to knock twice, and the one rule they turn on.
 *
 * Three things are pinned here: that a number the household actually has can be
 * *recorded* while a number an SMS must reach still cannot be a landline; that
 * the two halves of an identity — اسم الأم and محل القيد — are demanded of a
 * Lebanese citizen and excused by a flag like everything else; and that the
 * household is counted once, from the roster where there is one.
 */

const personal = (over: Record<string, unknown> = {}) => ({
  firstName: 'علي',
  middleName: 'حسن',
  lastName: 'خليل',
  gender: 'MALE',
  bloodType: 'O_POSITIVE',
  identityDocType: 'NATIONAL_ID',
  identityDocNumber: '12345',
  civilRecordNumber: '45',
  registrationPlaceTown: 'صور',
  motherName: 'مريم عواضه',
  nationality: 'لبناني',
  isLebanese: true,
  residentStatus: 'VILLAGE_RESIDENT',
  ...over,
});

const contact = (over: Record<string, unknown> = {}) => ({
  maritalStatus: 'MARRIED',
  phone: '03 123456',
  whatsappSameAsPhone: true,
  familySize: '4',
  ...over,
});

const submission = (over: { personal?: object; contact?: object } = {}) => ({
  personal: { ...personal(), ...(over.personal ?? {}) },
  contact: { ...contact(), ...(over.contact ?? {}) },
  properties: [
    {
      occupancyType: 'OWNER',
      propertyType: 'LAND',
      neighborhood: 'الحي الشرقي',
      propertyNumber: '1024',
      landType: 'AGRICULTURAL',
      unitArea: '500',
    },
  ],
  flags: [] as Array<{ path: string; reason: string }>,
});

describe('phone — recording a number is not the same as reaching one', () => {
  it('takes a Lebanese mobile, as it always did', () => {
    expect(contactPhone.parse('03 123456')).toBe('+9613123456');
    expect(contactPhone.parse('70-123456')).toBe('+96170123456');
  });

  /*
    The number that could not be entered at all. An elderly household on an
    Ogero line is exactly who a municipality most needs to reach, and the form
    used to refuse the only number they have.
  */
  it('takes an Ogero landline', () => {
    expect(contactPhone.parse('07 740123')).toBe('+9617740123');
    expect(contactPhone.parse('01 999888')).toBe('+9611999888');
  });

  /*
    A tenant's card *requires* the landlord's number, and a great many Lebanese
    landlords are abroad. The only way to file that card was to flag the field —
    a review-queue entry nobody could ever resolve, because the number was never
    missing.
  */
  it('takes a landlord abroad, in international form', () => {
    expect(contactPhone.parse('+971 50 1234567')).toBe('+971501234567');
    expect(contactPhone.parse('00 1 313 555 0142')).toBe('+13135550142');
  });

  it('reads Arabic-Indic digits, like every other number on this form', () => {
    expect(contactPhone.parse('٠٣ ١٢٣٤٥٦')).toBe('+9613123456');
  });

  it('still refuses nonsense, and a +961 that is not a Lebanese number', () => {
    expect(contactPhone.safeParse('123').success).toBe(false);
    expect(contactPhone.safeParse('+9612222222').success).toBe(false);
  });

  /*
    The OTP route is unchanged on purpose: an SMS to a landline is a code that
    never arrives, and a door that never opens is worse than one that says so.
    Such a citizen signs in with their رقم مرجعي instead.
  */
  it('keeps the SMS route mobile-only', () => {
    expect(lebaneseMobile.safeParse('07 740123').success).toBe(false);
    expect(lebaneseMobile.parse('03 123456')).toBe('+9613123456');
  });
});

describe('identity — the two fields that tell cousins apart', () => {
  it('accepts a Lebanese record carrying both', () => {
    expect(personalDetailsSchema.safeParse(personal()).success).toBe(true);
  });

  it('demands اسم الأم of a Lebanese citizen', () => {
    const result = personalDetailsSchema.safeParse(personal({ motherName: '' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('motherName');
  });

  it('demands محل القيد, because a سجل number alone identifies nobody', () => {
    const result = personalDetailsSchema.safeParse(personal({ registrationPlaceTown: '' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      'registrationPlaceTown',
    );
  });

  /*
    Neither is demanded of a passport holder: a Lebanese سجل is not a thing they
    have, and the إخراج قيد that guarantees a mother's name is not a document
    they carry.
  */
  it('asks neither of a non-Lebanese resident', () => {
    const result = personalDetailsSchema.safeParse(
      personal({
        isLebanese: false,
        nationality: 'سوري',
        identityDocType: 'PASSPORT',
        civilRecordNumber: '',
        registrationPlaceTown: '',
        motherName: '',
        residentStatus: 'REFUGEE',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('lets an officer flag either one and file the record anyway', () => {
    const result = adminCreateCitizenSubmissionSchema.safeParse({
      ...submission({ personal: { motherName: '', registrationPlaceTown: '' } }),
      flags: [
        { path: 'personal.motherName', reason: 'إخراج القيد عند الأخ في بيروت' },
        { path: 'personal.registrationPlaceTown', reason: 'إخراج القيد عند الأخ في بيروت' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('refuses a birth date in the future', () => {
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    expect(personalDetailsSchema.safeParse(personal({ dateOfBirth: nextYear })).success).toBe(false);
  });

  it('takes a well-formed birth date and leaves it as written', () => {
    const result = personalDetailsSchema.safeParse(personal({ dateOfBirth: '1976-03-14' }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dateOfBirth).toBe('1976-03-14');
  });
});

describe('household — counted once, from the roster where there is one', () => {
  const roster = [
    { fullName: 'فاطمة أحمد حرب', relationToHead: 'SPOUSE', birthYear: 1982, residesHere: true },
    { fullName: 'حسين', relationToHead: 'CHILD', birthYear: 2010, residesHere: true },
    { fullName: 'نور', relationToHead: 'CHILD', birthYear: 2014, residesHere: true },
  ];

  it('accepts a roster and does not also demand a count', () => {
    const result = contactDetailsSchema.safeParse(
      contact({ familySize: undefined, householdMembers: roster }),
    );
    expect(result.success).toBe(true);
  });

  it('still demands the count when nobody was named', () => {
    const result = contactDetailsSchema.safeParse(contact({ familySize: undefined }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('familySize');
  });

  it('derives the count from the roster including the registrant (+1), ignoring the typed number', () => {
    // 3 roster members + 1 registrant = 4
    expect(residentCountOf({ householdMembers: roster, familySize: 99 })).toBe(4);
  });

  it('does not add +1 if the roster already includes an explicit HEAD row', () => {
    const fullRoster = [
      { fullName: 'علي حسن خليل', relationToHead: 'HEAD', birthYear: 1980, residesHere: true },
      ...roster,
    ];
    expect(residentCountOf({ householdMembers: fullRoster })).toBe(4);
  });

  /*
    A son in Abidjan is on the family roster and is not in the town. Every
    occupancy figure filters him out; the roster itself keeps him.
  */
  it('leaves someone living abroad off the occupancy count', () => {
    const withEmigrant = [
      ...roster,
      { fullName: 'محمود', relationToHead: 'CHILD', birthYear: 2004, residesHere: false },
    ];
    // 1 registrant + 3 resident members = 4
    expect(residentCountOf({ householdMembers: withEmigrant })).toBe(4);
  });

  it('falls back to the integer for a record filed before rosters existed', () => {
    expect(residentCountOf({ familySize: 6 })).toBe(6);
    expect(residentCountOf({})).toBeNull();
  });

  it('carries the roster through the whole submission unchanged', () => {
    const result = adminCreateCitizenSubmissionSchema.safeParse({
      ...submission({ contact: { familySize: undefined, householdMembers: roster } }),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.contact.householdMembers).toHaveLength(3);
    expect(result.data.contact.householdMembers?.[0]?.relationToHead).toBe('SPOUSE');
  });

  /*
    The id has to survive the parse or the edit path cannot match a stored row
    against a submitted one — and every save would delete the roster and write
    it back under fresh identities.
  */
  it('carries a stored row id through, so an edit updates rather than replaces', () => {
    const result = contactDetailsSchema.safeParse(
      contact({
        familySize: undefined,
        householdMembers: [
          {
            id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
            fullName: 'حسين علي خليل',
            relationToHead: 'CHILD',
            residesHere: true,
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.householdMembers?.[0]?.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  /*
    A relative reciting a household frequently does not know a birth year, and
    the field is optional for exactly that reason. Coerced naively, the blank
    input becomes 0 and the officer is told the year is invalid with no way
    forward but to invent one.
  */
  it('reads a blank birth year as no answer rather than as year zero', () => {
    const result = contactDetailsSchema.safeParse(
      contact({
        familySize: undefined,
        householdMembers: [{ fullName: 'نور', relationToHead: 'CHILD', birthYear: '' }],
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.householdMembers?.[0]?.birthYear).toBeUndefined();
  });

  it('still coerces a birth year the officer did type', () => {
    const result = contactDetailsSchema.safeParse(
      contact({
        familySize: undefined,
        householdMembers: [{ fullName: 'نور', relationToHead: 'CHILD', birthYear: '٢٠١٤' }],
      }),
    );
    // Arabic-Indic digits are not folded here — that is `normalizeDigits`'
    // job at the import edge, and a browser number input never produces them.
    expect(result.success).toBe(false);

    const latin = contactDetailsSchema.safeParse(
      contact({
        familySize: undefined,
        householdMembers: [{ fullName: 'نور', relationToHead: 'CHILD', birthYear: '2014' }],
      }),
    );
    expect(latin.success).toBe(true);
    if (!latin.success) return;
    expect(latin.data.householdMembers?.[0]?.birthYear).toBe(2014);
  });

  /*
    The value that produced a save-time «تعذّر ربط المواطن بالأسرة» and no
    explanation: a citizen id pasted out of a URL into the رقم مرجعي field. It
    is not a reference, and saying so at the field is the difference between a
    typo the officer fixes in a second and a failure they cannot interpret.
  */
  it('refuses a citizen id pasted into the reference field', () => {
    const result = contactDetailsSchema.safeParse(
      contact({ householdReference: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      'householdReference',
    );
  });

  it('takes a reference as it is printed, however it is typed', () => {
    const result = contactDetailsSchema.safeParse(
      contact({ householdReference: ' bzr-2609-rxt2tf ' }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.householdReference).toBe('BZR-2609-RXT2TF');
  });

  it('leaves the field optional', () => {
    expect(contactDetailsSchema.safeParse(contact({ householdReference: '' })).success).toBe(true);
    expect(contactDetailsSchema.safeParse(contact()).success).toBe(true);
  });

  it('normalises the alternate number the same way the primary one is', () => {
    const result = contactDetailsSchema.safeParse(
      contact({ altPhone: '٠٧ ٧٤٠١٢٣', altPhoneRelation: 'ابنه' }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.altPhone).toBe('+9617740123');
  });
});
