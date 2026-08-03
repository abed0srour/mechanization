'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2, Layers, Plus, Trash2, X } from 'lucide-react';
import {
  ApiRequestError,
  createZone,
  deleteZone,
  getZone,
  getZones,
  logApiError,
  updateZone,
  type Session,
  type ZoneDetail,
  type ZoneSummary,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { ZoneModal, type ZoneFormValues } from '@/components/admin/zone-modal';

const ZoneEditorMap = dynamic(
  () => import('@/components/admin/zone-editor-map').then((m) => m.ZoneEditorMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        جاري تهيئة الخريطة…
      </div>
    ),
  },
);

/**
 * Sector management: the list of sectors on one side, the map they are drawn on
 * filling the rest.
 *
 * Deliberately one screen rather than a table page that opens a separate
 * editor. A sector is a shape before it is a record — its name and code mean
 * nothing without the parcels beside them — so the list and the map have to be
 * visible at the same time for the screen to be about anything.
 */
export default function ZonesPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [session, setSession] = useState<Session | null>(null);
  const [zones, setZones] = useState<ZoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** The sector open in the editor, or null when drawing a new one. */
  const [editing, setEditing] = useState<ZoneDetail | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [selectedParcels, setSelectedParcels] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const token = session?.accessToken ?? null;
  const canEdit = session?.user.role === 'SUPER_ADMIN';
  const editorOpen = drafting || editing !== null;

  useEffect(() => {
    const existing = loadSession(tenant);
    if (!existing || existing.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setSession(existing);
  }, [tenant, base, router]);

  const handleApiError = useCallback(
    (caught: unknown, fallback: string): string => {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return fallback;
      }
      return caught instanceof ApiRequestError ? caught.payload.message : fallback;
    },
    [tenant, base, router],
  );

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const response = await getZones(tenant, token);
      setZones(response.zones);
      setError(null);
    } catch (caught) {
      setError(handleApiError(caught, 'تعذّر تحميل القطاعات.'));
    } finally {
      setLoading(false);
    }
  }, [tenant, token, handleApiError]);

  useEffect(() => {
    if (!token) return;
    void reload();
  }, [token, reload]);

  // Auto-dismiss so a selection notice does not sit over the map indefinitely.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Parcel → colour for every saved sector.
   *
   * Loaded whenever the sector list is, not only while the editor is open: this
   * is what draws the sectors on the map at all, so gating it on editing made a
   * freshly-saved sector vanish the moment its editor closed and reappear only
   * when it was reopened.
   *
   * The list endpoint carries counts rather than membership, so this fetches
   * each sector once per list load — a handful of requests, not per-interaction.
   */
  const [ownership, setOwnership] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!token || zones.length === 0) {
      setOwnership({});
      return;
    }
    let cancelled = false;

    Promise.all(zones.map((zone) => getZone(tenant, token, zone.id)))
      .then((details) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const detail of details) {
          for (const parcelNumber of detail.parcelNumbers) map[parcelNumber] = detail.color;
        }
        setOwnership(map);
      })
      .catch(() => {
        // A failure here only costs the tint; the server still rejects a double
        // assignment on save, so the rule itself is not bypassed.
        if (!cancelled) setOwnership({});
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, token, zones]);

  /**
   * The sector under edit is dropped from the "already taken" set so its parcels
   * paint as *selected* rather than as somebody else's — and so deselecting one
   * leaves it genuinely blank instead of reverting to its old colour.
   */
  const assignments = useMemo(() => {
    if (!editing) return { takenByOtherZone: ownership };

    const mine = new Set(editing.parcelNumbers);
    const others: Record<string, string> = {};
    for (const [parcelNumber, color] of Object.entries(ownership)) {
      if (!mine.has(parcelNumber)) others[parcelNumber] = color;
    }
    return { takenByOtherZone: others };
  }, [ownership, editing]);

  const startNew = () => {
    setEditing(null);
    setDrafting(true);
    setSelectedParcels([]);
    setNotice('انقر على العقارات لتحديدها، أو استخدم Shift + سحب');
  };

  const startEdit = async (zoneId: string) => {
    if (!token) return;
    try {
      const detail = await getZone(tenant, token, zoneId);
      setEditing(detail);
      setDrafting(false);
      setSelectedParcels(detail.parcelNumbers);
    } catch (caught) {
      setError(handleApiError(caught, 'تعذّر فتح القطاع.'));
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setDrafting(false);
    setSelectedParcels([]);
    // Ownership deliberately survives: it is what keeps the saved sectors
    // painted on the map once the editor is gone.
  };

  const handleSave = async (values: ZoneFormValues) => {
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    const payload = {
      name: values.name.trim(),
      code: values.code.trim(),
      color: values.color,
      description: values.description.trim() || undefined,
      parcelNumbers: selectedParcels,
    };

    try {
      if (editing) await updateZone(tenant, token, editing.id, payload);
      else await createZone(tenant, token, payload);

      setModalOpen(false);
      closeEditor();
      await reload();
      setNotice(editing ? 'تم حفظ تعديلات القطاع' : 'تم إنشاء القطاع');
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError) {
        setFieldErrors(caught.fieldErrors);
        setSaveError(caught.payload.message);
      } else {
        setSaveError('تعذّر حفظ القطاع.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (zone: ZoneSummary) => {
    if (!token) return;
    // Confirmed because it is not undoable and the sector may carry hundreds of
    // parcels a colleague assigned; the count is named so the cost is visible.
    const ok = window.confirm(
      `حذف القطاع "${zone.name}"؟ سيتم إلغاء ربط ${zone.parcelCount} عقار به.`,
    );
    if (!ok) return;

    try {
      await deleteZone(tenant, token, zone.id);
      if (editing?.id === zone.id) closeEditor();
      await reload();
      setNotice('تم حذف القطاع');
    } catch (caught) {
      setError(handleApiError(caught, 'تعذّر حذف القطاع.'));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Layers className="size-5 text-primary" aria-hidden />
            إدارة القطاعات
          </h1>
          <p className="text-xs text-muted-foreground">
            قسّم عقارات البلدية إلى قطاعات إدارية على الخريطة
          </p>
        </div>
        {canEdit && !editorOpen ? (
          <Button onClick={startNew}>
            <Plus className="size-4" aria-hidden />
            قطاع جديد
          </Button>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Sector list — a fixed rail beside the map, not a table page. */}
        <aside className="flex w-72 shrink-0 flex-col border-e bg-background">
          {editorOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-bold">
                  {editing ? `تعديل: ${editing.name}` : 'قطاع جديد'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedParcels.length} عقار محدّد
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {selectedParcels.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    لم يتم تحديد أي عقار بعد
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {selectedParcels.map((parcelNumber) => (
                      <li key={parcelNumber}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedParcels((prev) => prev.filter((n) => n !== parcelNumber))
                          }
                          className="flex items-center gap-1 rounded-md border bg-accent/40 px-2 py-1 text-xs transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`إزالة العقار ${parcelNumber}`}
                        >
                          <span dir="ltr">{parcelNumber}</span>
                          <X className="size-3" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t p-3">
                <Button
                  onClick={() => {
                    setSaveError(null);
                    setFieldErrors({});
                    setModalOpen(true);
                  }}
                >
                  {editing ? 'حفظ التعديلات' : 'حفظ القطاع'}
                </Button>
                <Button variant="outline" onClick={closeEditor}>
                  إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  جاري التحميل…
                </div>
              ) : zones.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">لا توجد قطاعات بعد</p>
                  {canEdit ? (
                    <Button variant="outline" size="sm" className="mt-3" onClick={startNew}>
                      <Plus className="size-4" aria-hidden />
                      إنشاء أول قطاع
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="divide-y">
                  {zones.map((zone) => (
                    <li key={zone.id} className="flex items-center gap-2 px-3 py-2.5">
                      <span
                        className="size-4 shrink-0 rounded-sm border border-black/20"
                        style={{ backgroundColor: zone.color }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{zone.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span dir="ltr">{zone.code}</span> — {zone.parcelCount} عقار
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => void startEdit(zone.id)}
                          >
                            تعديل
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => void handleDelete(zone)}
                            aria-label={`حذف ${zone.name}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>

        <div className="relative min-w-0 flex-1">
          {token ? (
            <ZoneEditorMap
              tenant={tenant}
              selected={editorOpen ? selectedParcels : []}
              onSelectedChange={setSelectedParcels}
              assignments={assignments}
              onNotice={setNotice}
            />
          ) : null}

          {!editorOpen && !loading ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
              <p className="rounded-lg border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                {canEdit
                  ? 'اختر «قطاع جديد» أو «تعديل» لبدء تحديد العقارات'
                  : 'عرض فقط — تعديل القطاعات متاح لمدير النظام'}
              </p>
            </div>
          ) : null}

          {notice ? (
            <div
              role="status"
              // Stacks above the editor's own hint pill, which itself clears the
              // basemap switcher — three floating things share this column.
              className="absolute bottom-36 left-1/2 z-20 -translate-x-1/2 rounded-lg border bg-card px-4 py-2 text-sm shadow-lg"
            >
              {notice}
            </div>
          ) : null}
        </div>
      </div>

      <ZoneModal
        open={modalOpen}
        zone={editing}
        parcelCount={selectedParcels.length}
        saving={saving}
        error={saveError}
        fieldErrors={fieldErrors}
        onSave={handleSave}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}
