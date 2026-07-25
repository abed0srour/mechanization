import { ValidationError } from '../errors/domain-error';

export type DocumentType =
  | 'IDENTITY'
  | 'OWNERSHIP_PROOF'
  | 'RENTAL_CONTRACT'
  | 'RESIDENCY_PROOF'
  | 'EXTRA_PHOTO';

/**
 * What a citizen can actually produce on a phone: a photo of a document, or a
 * PDF from a lawyer's office. Anything else is either a mistake or an attempt to
 * put executable content in a bucket that municipality staff will later click.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const MAX_BYTES = 10 * 1024 * 1024;

export interface DocumentProps {
  id: string;
  registrationId: string;
  propertyEntryId?: string | null;
  type: DocumentType;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export class Document {
  private constructor(readonly props: Readonly<DocumentProps>) {}

  static create(props: DocumentProps): Document {
    Document.assertUploadable(props.mimeType, props.sizeBytes);

    /**
     * Person-level documents (identity) belong to the registration; proofs
     * belong to a specific property card. Getting this wrong would attach a
     * rental contract to the wrong flat during review.
     */
    const isPerProperty = props.type === 'OWNERSHIP_PROOF' || props.type === 'RENTAL_CONTRACT';
    if (isPerProperty && !props.propertyEntryId) {
      throw new ValidationError(`A ${props.type} must be attached to a specific property`);
    }
    if (props.type === 'IDENTITY' && props.propertyEntryId) {
      throw new ValidationError('An identity document belongs to the person, not a property');
    }

    return new Document(props);
  }

  static assertUploadable(mimeType: string, sizeBytes: number): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      throw new ValidationError('نوع الملف غير مدعوم — يرجى إرفاق صورة أو ملف PDF');
    }
    if (sizeBytes <= 0) {
      throw new ValidationError('الملف فارغ');
    }
    if (sizeBytes > MAX_BYTES) {
      throw new ValidationError('حجم الملف كبير جداً — الحد الأقصى 10 ميغابايت');
    }
  }

  static get allowedMimeTypes(): string[] {
    return [...ALLOWED_MIME_TYPES];
  }

  static get maxBytes(): number {
    return MAX_BYTES;
  }
}
