export interface UploadRequest {
  /** Tenant slug — the first path segment, so one municipality's objects can
   *  never collide with another's even inside a shared bucket. */
  tenantSlug: string;
  citizenId: string;
  registrationId: string;
  propertyEntryId?: string | null;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface ImageStorageService {
  upload(request: UploadRequest): Promise<{ storagePath: string }>;

  /**
   * Short-lived signed URL. Documents are never public: a leaked permanent link
   * to a scan of someone's national ID is a leak that cannot be undone.
   */
  createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;

  remove(storagePath: string): Promise<void>;
}
