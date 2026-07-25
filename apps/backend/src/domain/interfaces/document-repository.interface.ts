import { Document, DocumentType } from '../entities/document.entity';

export interface StoredDocument {
  id: string;
  type: DocumentType;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  propertyEntryId: string | null;
  createdAt: Date;
}

export interface DocumentRepository {
  saveMany(documents: Document[]): Promise<string[]>;
  listByRegistration(registrationId: string): Promise<StoredDocument[]>;
  findById(id: string): Promise<StoredDocument | null>;
}
