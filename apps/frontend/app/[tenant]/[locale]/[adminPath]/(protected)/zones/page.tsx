'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
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
import { DraggablePanel } from '@/components/admin/draggable-panel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

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
  /** The sector whose deletion is being confirmed, or null. */
  const [pendingDelete, setPendingDelete] = useState<ZoneSummary | null>(null);
  const toast = useToast();

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

  /*
   * Confirmed because it is not undoable and the sector may carry hundreds of
   * parcels a colleague assigned; the count is named so the cost is visible.
   * In a dialog rather than `window.confirm`, which renders LTR over an RTL
   * page and quotes the sector's Arabic name into a Latin-ordered sentence.
   */
  const handleDelete = async (zone: ZoneSummary) => {
    if (!token) throw new Error('انتهت الجلسة.');
    try {
      await deleteZone(tenant, token, zone.id);
      if (editing?.id === zone.id) closeEditor();
      await reload();
      toast.success('تم حذف القطاع', {
        description: `${zone.name} — أصبح ${zone.parcelCount} عقار بلا قطاع.`,
      });
    } catch (caught) {
      const message = handleApiError(caught, 'تعذّر حذف القطاع.');
      setError(message);
      throw new Error(message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/*
        The page header is gone with the one button it held. «قطاع جديد» now
        sits at the foot of the sector panel, next to the list it adds to,
        rather than in a bar at the top of the screen that existed only to
        carry it.
      */}
      {error ? (
        <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {/*
          The sector list floats over the map and can be dragged out of the way.
          As a fixed rail it covered whichever part of the town happened to be
          behind it, and the only way to see under it was to pan the map — which
          moves the thing being looked at.
        */}
        {/*
          The drag bar carries the title, so the editor's own heading row is
          gone — two headings stacked on a 288px panel was most of its top
          third. The selected-parcel count survives as the line under it, which
          is the part that actually changes while editing.
        */}
        <DraggablePanel
          storageKey="zones-list"
          title={editorOpen ? (editing ? `تعديل: ${editing.name}` : 'قطاع جديد') : 'القطاعات'}
        >
          {editorOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b px-4 py-2">
                <p className="text-xs text-muted-foreground">
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
                // No "create the first sector" button here any more: the same
                // button now sits permanently at the panel's foot, and two of
                // them a centimetre apart is not encouragement, it is doubt
                // about which one does what.
                <div className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">لا توجد قطاعات بعد</p>
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
                            onClick={() => setPendingDelete(zone)}
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

              {/*
                At the foot of the list rather than in a page header: the button
                that adds a sector belongs beside the sectors, and this is also
                the one spot that stays put as the panel is dragged around.
              */}
              {canEdit ? (
                <div className="sticky bottom-0 border-t bg-card p-3">
                  <Button className="w-full" onClick={startNew}>
                    <Plus className="size-4" aria-hidden />
                    قطاع جديد
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </DraggablePanel>

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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="حذف القطاع"
        description={
          pendingDelete ? (
            <>
              سيُحذف القطاع{' '}
              <span className="font-semibold text-foreground">{pendingDelete.name}</span>، وسيصبح{' '}
              {pendingDelete.parcelCount} عقار بلا قطاع. العقارات نفسها لا تتأثر.
            </>
          ) : null
        }
        confirmLabel="حذف القطاع"
        onConfirm={async () => {
          if (pendingDelete) await handleDelete(pendingDelete);
        }}
      />
    </div>
  );
}
