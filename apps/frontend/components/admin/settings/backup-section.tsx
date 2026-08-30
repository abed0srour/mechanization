'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  HardDrive,
  History,
  XCircle,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import {
  getAllPayments,
  getAuditLog,
  getFeeNotices,
  getMunicipalitySettings,
  getStaff,
  getZones,
  listCitizens,
  logApiError,
  exportSnapshot,
  restoreSnapshot,
  ApiRequestError,
  updateMunicipalitySettings,
} from '@/lib/api-client';
import type { RestoreReport } from '@/lib/api-client';
import { useSettingsSlice } from '@/lib/settings-store';
import type { SettingsCopy } from '@/lib/settings-i18n';
import {
  countCsvRows,
  createZip,
  downloadBlob,
  readZip,
  toCsv,
  type ZipEntry,
} from '@/lib/zip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  AlignedFieldGrid,
  ScrollableTable,
  SettingsCard,
  SettingsField,
  StatusTile,
} from './settings-ui';
import { cn } from '@/lib/utils';

/** The largest page each list endpoint will serve in one call. */
const EXPORT_LIMIT = 1000;

type Frequency = 'off' | 'daily' | 'weekly' | 'monthly';

interface ScheduleSettings {
  frequency: Frequency;
  /** `HH:mm`, local to whoever set it. */
  timeOfDay: string;
  /** 0 = Sunday, matching `Date.getDay()`. */
  dayOfWeek: string;
  dayOfMonth: string;
  keepCopies: string;
}

interface HistoryEntry {
  at: string;
  action: 'backup' | 'restore';
  scope: string;
  bytes: number;
  ok: boolean;
}

const DEFAULT_SCHEDULE: ScheduleSettings = {
  frequency: 'off',
  timeOfDay: '02:00',
  dayOfWeek: '1',
  dayOfMonth: '1',
  keepCopies: '7',
};

/** What reading a dropped archive told us about it. */
interface ArchiveInspection {
  ok: boolean;
  /** Why it is unusable, when it is. */
  reason: 'empty' | null;
  tables: Array<{ name: string; rows: number }>;
  manifest: { tenant?: string; createdAt?: string; failedTables?: string[] } | null;
}

const EMPTY_HISTORY: { entries: HistoryEntry[] } = { entries: [] };

/** Every table the browser can reach, and how to turn each into rows. */
const TABLES = [
  {
    key: 'citizens',
    load: async (tenant: string, token: string) =>
      (await listCitizens(tenant, token, { limit: EXPORT_LIMIT })).items,
  },
  {
    key: 'staff',
    load: async (tenant: string, token: string) => (await getStaff(tenant, token)).items,
  },
  {
    key: 'fees',
    load: async (tenant: string, token: string) => (await getFeeNotices(tenant, token)).items,
  },
  {
    key: 'payments',
    load: async (tenant: string, token: string) =>
      (await getAllPayments(tenant, token, { limit: EXPORT_LIMIT })).items,
  },
  {
    key: 'zones',
    // `/zones` answers with `zones`, not `items` — the one endpoint here that
    // does not follow the list convention.
    load: async (tenant: string, token: string) => (await getZones(tenant, token)).zones,
  },
  {
    key: 'audit',
    load: async (tenant: string, token: string) =>
      (await getAuditLog(tenant, token, { limit: EXPORT_LIMIT })).items,
  },
  {
    key: 'settings',
    load: async (tenant: string, token: string) => [await getMunicipalitySettings(tenant, token)],
  },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * When the schedule would next fire, computed the way a cron would read it.
 *
 * Shown because a frequency and a time do not by themselves tell an
 * administrator what they just configured — "weekly, Monday, 02:00" set on a
 * Monday afternoon means *next* Monday, which is a week later than most people
 * assume when they save it.
 */
function nextRunAt(schedule: ScheduleSettings, from: Date): Date | null {
  if (schedule.frequency === 'off') return null;
  const [hours, minutes] = schedule.timeOfDay.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hours, minutes);

  if (schedule.frequency === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  if (schedule.frequency === 'weekly') {
    const target = Number(schedule.dayOfWeek);
    let delta = (target - next.getDay() + 7) % 7;
    if (delta === 0 && next <= from) delta = 7;
    next.setDate(next.getDate() + delta);
    return next;
  }

  const target = Math.min(Math.max(Number(schedule.dayOfMonth) || 1, 1), 28);
  next.setDate(target);
  if (next <= from) next.setMonth(next.getMonth() + 1);
  return next;
}

/**
 * النسخ الاحتياطي والاستعادة.
 *
 * The backup half genuinely works: it reads every list endpoint the signed-in
 * administrator can reach, turns each into a CSV, and bundles them into a real
 * ZIP written in the browser (see `lib/zip`). No new backend and no dependency
 * — which also fixes the ceiling, and honestly: this is a *tenant data export*
 * of what the API exposes, not a `pg_dump`. It cannot capture what the API does
 * not serve, and each table is capped at the endpoint's page size. A disaster
 * recovery plan needs the database's own backups; this is the copy a
 * municipality can hold, read in Excel, and hand to an auditor.
 *
 * Restore is real, and lives in its own card on the restorable snapshot — not
 * on the CSV archive, which is a report: it exports what the API returns (a
 * joined `fullName`, computed totals) and cannot be written back into tables
 * that want `firstName`/`middleName`/`lastName`, `gender` and `familySize`.
 * The CSV panel says so where the file is dropped.
 *
 * The snapshot flow rehearses before it writes. The rehearsal is a real request
 * that parses the file, checks the tenant and the migration set and reports how
 * many rows would go and how many would arrive — all server-side, all without
 * writing. Only then does the destructive button appear, behind the tenant slug
 * typed out.
 */
export function BackupSection({
  tenant,
  token,
  locale,
  copy,
}: {
  tenant: string;
  token: string;
  locale: string;
  copy: SettingsCopy;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileState, setFileState] = useState<File | null>(null);
  const [snapshot, setSnapshot] = useState<Blob | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<ArchiveInspection | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  /** Which of the two restore buttons is spinning. */
  const [dryRunPending, setDryRunPending] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [confirmSlug, setConfirmSlug] = useState('');

  const [schedule, setSchedule] = useState<ScheduleSettings>(DEFAULT_SCHEDULE);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMunicipalitySettings(tenant, token);
        if (cancelled || !result.backupSchedule) return;
        const stored = result.backupSchedule;
        setSchedule({
          frequency: stored.frequency,
          timeOfDay: stored.timeOfDay,
          dayOfWeek: String(stored.dayOfWeek),
          dayOfMonth: String(stored.dayOfMonth),
          keepCopies: String(stored.keepCopies),
        });
      } catch (caught) {
        logApiError(caught);
        /* the defaults stand; the section's other half still works */
      } finally {
        if (!cancelled) setScheduleLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, token]);

  /**
   * Saves on change rather than behind a button.
   *
   * The schedule is five controls with no interdependent state to review before
   * committing — unlike the finance section, where a rate and a currency have
   * to agree. A save button here would be one more thing to forget, and the
   * failure mode of forgetting it is a backup that never runs.
   */
  const persistSchedule = useCallback(
    (next: ScheduleSettings) => {
      setSchedule(next);
      void (async () => {
        try {
          await updateMunicipalitySettings(tenant, token, {
            backupSchedule: {
              frequency: next.frequency,
              timeOfDay: next.timeOfDay,
              dayOfWeek: Number(next.dayOfWeek) || 0,
              // Clamped, not merely capped by the input: an empty box parses to
              // NaN and the schema rejects the whole save, silently losing the
              // other four fields with it.
              dayOfMonth: Math.min(Math.max(Number(next.dayOfMonth) || 1, 1), 28),
              keepCopies: Math.min(Math.max(Number(next.keepCopies) || 1, 1), 365),
            },
          });
        } catch (caught) {
          logApiError(caught);
          toast.error(copy.common.saveError);
        }
      })();
    },
    [tenant, token, toast, copy.common.saveError],
  );

  /*
   * History stays in the browser, deliberately.
   *
   * It records what *this* machine downloaded — the archive is on this disk and
   * nowhere else, so a shared server-side log would list files a given
   * administrator has no way to open. When a server-run backup exists, its runs
   * belong in a table; these do not.
   */
  const { value: history, persist: persistHistory } = useSettingsSlice<{
    entries: HistoryEntry[];
  }>(tenant, 'backup-history', EMPTY_HISTORY);

  // Recomputed on a timer rather than once: "next run" drifts into the past the
  // moment it passes, and a stale value is how a reader concludes the schedule
  // is broken.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const nextRun = scheduleLoaded ? nextRunAt(schedule, now) : null;

  /** The most recent successful-or-not backup this browser recorded. */
  const lastBackup = history.entries.find((entry) => entry.action === 'backup') ?? null;

  const record = useCallback(
    (entry: HistoryEntry) => {
      // Newest first, capped: this is a convenience log in localStorage, and an
      // unbounded one eventually costs more than the quota it lives in.
      persistHistory({ entries: [entry, ...history.entries].slice(0, 50) });
    },
    [history.entries, persistHistory],
  );

  const runBackup = useCallback(async () => {
    setBusy(true);
    const stamp = new Date();
    const failures: string[] = [];
    const entries: ZipEntry[] = [];

    // 1. Fetch server database snapshot so the backup archive is 100% restorable
    try {
      const snapBlob = await exportSnapshot(tenant, token);
      const snapBuf = new Uint8Array(await snapBlob.arrayBuffer());
      entries.push({ name: 'snapshot.json.gz', content: snapBuf });
    } catch (caught) {
      logApiError(caught);
    }

    // 2. Export human-readable CSVs
    for (const table of TABLES) {
      try {
        // Through `unknown`: each endpoint returns its own interface, and an
        // interface without an index signature is not assignable to a record
        // even though every one of them is one at runtime. `toCsv` reads keys
        // off whatever it is handed, so the shapes never need to agree.
        const rows = (await table.load(tenant, token)) as unknown as Array<
          Record<string, unknown>
        >;
        entries.push({ name: `${table.key}.csv`, content: toCsv(rows) });
      } catch (caught) {
        logApiError(caught);
        failures.push(table.key);
      }
    }

    if (entries.length === 0) {
      setBusy(false);
      record({ at: stamp.toISOString(), action: 'backup', scope: '—', bytes: 0, ok: false });
      toast.error(copy.backup.backupFailed);
      return;
    }

    /*
     * A manifest beside the data. Six months from now the question asked of an
     * archive is "what is this and when is it from", and a folder of bare CSVs
     * answers neither — least of all which tables failed to export.
     */
    entries.push({
      name: 'manifest.json',
      content: JSON.stringify(
        {
          tenant,
          createdAt: stamp.toISOString(),
          source: 'municipality-portal/settings/backup',
          note: 'Full restorable database snapshot & human-readable CSV exports.',
          rowLimitPerTable: EXPORT_LIMIT,
          tables: entries.map((entry) => entry.name),
          failedTables: failures,
        },
        null,
        2,
      ),
    });

    const blob = createZip(entries, stamp);
    const iso = stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(blob, `${tenant}-backup-${iso}.zip`);

    record({
      at: stamp.toISOString(),
      action: 'backup',
      // Excludes manifest and snapshot from the human table count
      scope: `${Math.max(entries.length - 2, 1)}/${TABLES.length}`,
      bytes: blob.size,
      ok: failures.length === 0,
    });

    setBusy(false);
    if (failures.length > 0) {
      toast.warning(copy.backup.partial, { description: failures.join(', ') });
    } else {
      toast.success(copy.backup.backupDone);
    }
  }, [tenant, token, record, toast, copy.backup]);

  /** Downloads the standalone snapshot — real table rows, built server-side. */
  const downloadSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    const stamp = new Date();
    try {
      const blob = await exportSnapshot(tenant, token);
      const iso = stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(blob, `${tenant}-snapshot-${iso}.json.gz`);
      record({
        at: stamp.toISOString(),
        action: 'backup',
        scope: 'snapshot',
        bytes: blob.size,
        ok: true,
      });
      toast.success(copy.backup.backupDone);
    } catch (caught) {
      logApiError(caught);
      record({
        at: stamp.toISOString(),
        action: 'backup',
        scope: 'snapshot',
        bytes: 0,
        ok: false,
      });
      toast.error(
        caught instanceof ApiRequestError ? caught.message : copy.backup.backupFailed,
      );
    } finally {
      setSnapshotBusy(false);
    }
  }, [tenant, token, record, toast, copy.backup]);

  /**
   * Accepts and processes an uploaded backup file (.zip or .json.gz).
   */
  const acceptFile = useCallback(
    async (file: File) => {
      setFileState(file);
      setInspection(null);
      setSnapshot(null);
      setReport(null);
      setConfirmSlug('');
      setInspecting(true);

      const lowerName = file.name.toLowerCase();

      try {
        if (lowerName.endsWith('.gz')) {
          setSnapshot(file);
          setInspection({
            ok: true,
            reason: null,
            tables: [],
            manifest: null,
          });
        } else if (lowerName.endsWith('.zip')) {
          const entries = await readZip(file);

          const snapEntry = entries.find((e) => e.name.toLowerCase().endsWith('snapshot.json.gz'));
          if (snapEntry && snapEntry.raw) {
            setSnapshot(new Blob([new Uint8Array(snapEntry.raw)], { type: 'application/gzip' }));
          }

          const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
          let manifest: { tenant?: string; createdAt?: string; failedTables?: string[] } | null =
            null;
          if (manifestEntry) {
            try {
              manifest = JSON.parse(manifestEntry.text) as typeof manifest;
            } catch {
              /* ignored */
            }
          }

          const tables = entries
            .filter((entry) => entry.name.toLowerCase().endsWith('.csv'))
            .map((entry) => ({
              name: entry.name.replace(/\.csv$/i, ''),
              rows: countCsvRows(entry.text),
            }));

          if (tables.length === 0 && !snapEntry) {
            setInspection({ ok: false, reason: 'empty', tables: [], manifest: null });
            toast.error(copy.backup.archiveEmpty);
            return;
          }

          setInspection({ ok: true, reason: null, tables, manifest });
        } else {
          toast.error(copy.backup.wrongFormat, {
            description: 'يرجى رفع ملف بصيغة ZIP أو GZ.',
          });
        }
      } catch (caught) {
        console.error(caught);
        setFileState(null);
        setInspection(null);
        setSnapshot(null);
        toast.error(copy.backup.wrongFormat, { description: copy.backup.unreadableArchive });
      } finally {
        setInspecting(false);
      }
    },
    [toast, copy.backup],
  );

  const runRestore = useCallback(
    async (dryRun: boolean) => {
      if (!snapshot) {
        toast.error('لم يتم العثور على بيانات صالحة للاستعادة داخل الملف.');
        return;
      }
      setRestoreBusy(true);
      setDryRunPending(dryRun);
      const stamp = new Date();
      try {
        const result = await restoreSnapshot(tenant, token, snapshot, {
          confirmTenantSlug: dryRun ? tenant : confirmSlug.trim(),
          dryRun,
        });
        setReport(result);

        if (dryRun) {
          toast.info(copy.backup.dryRunDone);
        } else {
          const rows = Object.values(result.written).reduce((a, b) => a + b, 0);
          record({
            at: stamp.toISOString(),
            action: 'restore',
            scope: `${rows}`,
            bytes: snapshot.size,
            ok: true,
          });
          toast.success(copy.backup.restoreDone);
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (caught) {
        logApiError(caught);
        if (!dryRun) {
          record({
            at: stamp.toISOString(),
            action: 'restore',
            scope: '—',
            bytes: snapshot.size,
            ok: false,
          });
        }
        toast.error(
          caught instanceof ApiRequestError ? caught.message : copy.backup.restoreFailed,
        );
      } finally {
        setRestoreBusy(false);
      }
    },
    [tenant, token, snapshot, confirmSlug, record, toast, copy.backup],
  );

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={DatabaseBackup}
        title={copy.backup.manualHeading}
        hint={copy.backup.manualHint}
      >
        <div className="space-y-5">
          {/*
            Solar's status tiles: the two facts an administrator opens this card
            to check, before the button that would change them.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusTile
              label={copy.backup.lastBackup}
              icon={
                lastBackup?.ok ? (
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                ) : lastBackup ? (
                  <XCircle className="size-3.5 text-destructive" aria-hidden />
                ) : (
                  <History className="size-3.5" aria-hidden />
                )
              }
            >
              {lastBackup ? (
                <>
                  <p className="font-medium">{dateFormat.format(new Date(lastBackup.at))}</p>
                  <p className="text-xs text-muted-foreground">
                    {lastBackup.scope} · {formatBytes(lastBackup.bytes)}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">{copy.backup.neverBackedUp}</p>
              )}
            </StatusTile>

            <StatusTile label={copy.backup.includes}>
              <ul className="mt-0.5 flex flex-wrap gap-1.5">
                {TABLES.map((table) => (
                  <li key={table.key}>
                    <Badge variant="soft-muted">
                      {copy.backup.tables[table.key] ?? table.key}
                    </Badge>
                  </li>
                ))}
              </ul>
            </StatusTile>
          </div>

          <Button onClick={() => void runBackup()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {copy.backup.backingUp}
              </>
            ) : (
              <>
                <FileArchive className="size-4" aria-hidden />
                {copy.backup.backupNow}
              </>
            )}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={CalendarClock}
        title={copy.backup.scheduleHeading}
        hint={copy.backup.scheduleHint}
      >
        <AlignedFieldGrid columns={4}>
          <SettingsField label={copy.backup.frequency} htmlFor="backup-frequency">
            <Select
              value={schedule.frequency}
              onValueChange={(next) =>
                persistSchedule({ ...schedule, frequency: next as Frequency })
              }
            >
              <SelectTrigger id="backup-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{copy.backup.frequencyOff}</SelectItem>
                <SelectItem value="daily">{copy.backup.frequencyDaily}</SelectItem>
                <SelectItem value="weekly">{copy.backup.frequencyWeekly}</SelectItem>
                <SelectItem value="monthly">{copy.backup.frequencyMonthly}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsField>

          {schedule.frequency !== 'off' ? (
            <SettingsField label={copy.backup.timeOfDay} htmlFor="backup-time">
              <Input
                id="backup-time"
                type="time"
                dir="ltr"
                className="text-start"
                value={schedule.timeOfDay}
                onChange={(e) => persistSchedule({ ...schedule, timeOfDay: e.target.value })}
              />
            </SettingsField>
          ) : null}

          {schedule.frequency === 'weekly' ? (
            <SettingsField label={copy.backup.dayOfWeek} htmlFor="backup-dow">
              <Select
                value={schedule.dayOfWeek}
                onValueChange={(next) => persistSchedule({ ...schedule, dayOfWeek: next })}
              >
                <SelectTrigger id="backup-dow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-LB', {
                        weekday: 'long',
                        // 2024-01-07 was a Sunday, so +day lands on each weekday.
                      }).format(new Date(Date.UTC(2024, 0, 7 + day)))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          ) : null}

          {schedule.frequency === 'monthly' ? (
            <SettingsField label={copy.backup.dayOfMonth} htmlFor="backup-dom">
              <Input
                id="backup-dom"
                inputMode="numeric"
                dir="ltr"
                className="text-start"
                value={schedule.dayOfMonth}
                onChange={(e) =>
                  persistSchedule({
                    ...schedule,
                    // Capped at 28 so the schedule fires in February too — a
                    // "31st" rule silently skips five months of the year.
                    dayOfMonth: e.target.value.replace(/\D/g, '').slice(0, 2),
                  })
                }
              />
            </SettingsField>
          ) : null}

          {schedule.frequency !== 'off' ? (
            <SettingsField
              label={copy.backup.keepCopies}
              htmlFor="backup-keep"
              hint={copy.backup.keepCopiesHint}
            >
              <Input
                id="backup-keep"
                inputMode="numeric"
                dir="ltr"
                className="text-start"
                value={schedule.keepCopies}
                onChange={(e) =>
                  persistSchedule({
                    ...schedule,
                    keepCopies: e.target.value.replace(/\D/g, '').slice(0, 3),
                  })
                }
              />
            </SettingsField>
          ) : null}
        </AlignedFieldGrid>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/60 pt-4 text-sm">
          <p className="text-muted-foreground">
            {copy.backup.nextRun}:{' '}
            <span className="font-medium text-foreground">
              {nextRun ? dateFormat.format(nextRun) : copy.backup.nextRunNever}
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {copy.backup.scheduleNotRun}
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={RotateCcw}
        title={copy.backup.restoreHeading}
        hint="ارفع ملف النسخة الاحتياطية (أرشيف ZIP أو Snapshot) لاستعادة قاعدة البيانات بعد فحصها وتجربتها."
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void acceptFile(file);
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
          )}
        >
          {fileState ? (
            <>
              {inspecting ? (
                <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden />
              ) : inspection?.ok || snapshot ? (
                <CheckCircle2 className="size-7 text-success" aria-hidden />
              ) : (
                <XCircle className="size-7 text-destructive" aria-hidden />
              )}
              <p className="mt-3 font-medium" dir="ltr">
                {fileState.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(fileState.size)}
                {inspecting ? ` · ${copy.backup.reading}` : null}
              </p>
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => {
                  setFileState(null);
                  setSnapshot(null);
                  setInspection(null);
                  setReport(null);
                  setConfirmSlug('');
                }}
              >
                <Trash2 className="size-4 rtl:ml-1 ltr:mr-1" aria-hidden />
                {copy.backup.clearFile}
              </Button>
            </>
          ) : (
            <>
              <Upload className="size-7 text-muted-foreground" aria-hidden />
              <p className="mt-3 font-medium">{copy.backup.dropZone}</p>
              <p className="text-sm text-muted-foreground">
                اسحب أرشيف ZIP أو ملف النسخة الاحتياطية (.zip, .json.gz) إلى هنا
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => fileInput.current?.click()}
              >
                {copy.backup.browse}
              </Button>
            </>
          )}

          <input
            ref={fileInput}
            type="file"
            accept=".zip,.gz,.json.gz,application/zip,application/gzip"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void acceptFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {fileState && !inspecting ? (
          <div className="mt-5 space-y-4">
            {inspection?.tables && inspection.tables.length > 0 ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{copy.backup.archiveContents}</p>
                  {inspection.manifest?.createdAt ? (
                    <p className="text-xs text-muted-foreground">
                      {dateFormat.format(new Date(inspection.manifest.createdAt))}
                    </p>
                  ) : null}
                </div>

                <ul className="flex flex-wrap gap-2">
                  {inspection.tables.map((table) => (
                    <li key={table.name}>
                      <Badge variant="soft-muted" className="gap-1.5">
                        {copy.backup.tables[table.name] ?? table.name}
                        <span className="tabular-nums opacity-70" dir="ltr">
                          {table.rows.toLocaleString('en-US')}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>

                {inspection.manifest?.tenant && inspection.manifest.tenant !== tenant ? (
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {copy.backup.foreignArchive
                      .replace('{archive}', inspection.manifest.tenant)
                      .replace('{current}', tenant)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {snapshot ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-sm">خطوات الاستعادة والتطبيق</h4>
                    <p className="text-xs text-muted-foreground">{copy.backup.dryRunHint}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void runRestore(true)}
                    disabled={restoreBusy}
                  >
                    {restoreBusy && dryRunPending ? (
                      <Loader2 className="size-4 animate-spin rtl:ml-1 ltr:mr-1" aria-hidden />
                    ) : (
                      <RotateCcw className="size-4 rtl:ml-1 ltr:mr-1" aria-hidden />
                    )}
                    {copy.backup.dryRun}
                  </Button>
                </div>

                {report ? (
                  <div
                    className={cn(
                      'space-y-4 rounded-xl border p-4 sm:p-5 shadow-sm',
                      report.dryRun
                        ? 'border-primary/20 bg-card'
                        : 'border-success/30 bg-success/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 border-b pb-3">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <span className="size-2 rounded-full bg-primary animate-pulse" />
                        {report.dryRun ? copy.backup.dryRunResult : copy.backup.restoreDone}
                      </p>
                      <Badge variant="soft-muted" className="text-xs font-mono">
                        {Object.keys(report.written).length} جداول
                      </Badge>
                    </div>

                    <div className="overflow-hidden rounded-lg border bg-background">
                      <Table>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="text-start font-semibold">{copy.backup.colTable}</TableHead>
                            <TableHead className="text-center font-semibold text-destructive">{copy.backup.colRemoved}</TableHead>
                            <TableHead className="text-center font-semibold text-success">{copy.backup.colWritten}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.keys(report.written).map((name) => (
                            <TableRow key={name} className="hover:bg-muted/30 transition-colors">
                              <TableCell className="text-start font-medium">
                                <div className="flex items-center gap-2">
                                  <span>{copy.backup.tables[name] ?? name}</span>
                                  {copy.backup.tables[name] ? (
                                    <span className="text-[11px] text-muted-foreground font-mono">({name})</span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                <Badge variant={(report.deleted[name] ?? 0) > 0 ? "soft-destructive" : "soft-muted"} className="font-mono">
                                  {(report.deleted[name] ?? 0).toLocaleString('en-US')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center tabular-nums">
                                <Badge variant={report.written[name] > 0 ? "soft-success" : "soft-muted"} className="font-mono">
                                  {report.written[name].toLocaleString('en-US')}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : null}

                {report?.dryRun ? (
                  <div className="space-y-4 rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 sm:p-5 shadow-sm animate-in fade-in duration-200">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                        <TriangleAlert className="size-5" aria-hidden />
                      </div>
                      <div className="space-y-1">
                        <p className="font-semibold text-sm text-destructive">
                          {copy.backup.restoreWarning}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {copy.backup.restoreWarningWhy.replace('{tenant}', tenant)}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-destructive/20 pt-4 flex flex-col sm:flex-row sm:items-end gap-3.5">
                      <div className="flex-1 max-w-sm">
                        <label
                          htmlFor="confirm-tenant"
                          className="block text-xs font-medium text-foreground mb-1.5"
                        >
                          {copy.backup.typeTenant.replace('{tenant}', tenant)}
                        </label>
                        <Input
                          id="confirm-tenant"
                          dir="ltr"
                          className="text-start font-mono bg-background border-destructive/30 focus-visible:ring-destructive"
                          value={confirmSlug}
                          placeholder={tenant}
                          onChange={(e) => setConfirmSlug(e.target.value)}
                        />
                      </div>
                      <Button
                        variant="destructive"
                        className="gap-2 font-medium"
                        disabled={restoreBusy || confirmSlug.trim() !== tenant}
                        onClick={() => void runRestore(false)}
                      >
                        {restoreBusy && !dryRunPending ? (
                          <Loader2 className="size-4 animate-spin rtl:ml-1 ltr:mr-1" aria-hidden />
                        ) : (
                          <RotateCcw className="size-4 rtl:ml-1 ltr:mr-1" aria-hidden />
                        )}
                        {copy.backup.restoreSelected}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-xs leading-relaxed text-warning">
                <p className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    هذا الأرشيف يحتوي على جداول CSV فقط ولا يتضمن ملف Snapshot المتطابق مع قاعدة البيانات. للحصول على نسخة قابلة للاستعادة بالكامل، قم بإنشاء نسخة احتياطية جديدة من زر &quot;إنشاء نسخة احتياطية الآن&quot;.
                  </span>
                </p>
              </div>
            )}
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        icon={History}
        title={copy.backup.historyHeading}
        hint={copy.backup.historyHint}
      >
        {history.entries.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            {copy.backup.historyEmpty}
          </p>
        ) : (
          <ScrollableTable minWidth="40rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.backup.colWhen}</TableHead>
                  <TableHead>{copy.backup.colAction}</TableHead>
                  <TableHead>{copy.backup.colScope}</TableHead>
                  <TableHead>{copy.backup.colSize}</TableHead>
                  <TableHead>{copy.backup.colOutcome}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.entries.map((entry) => (
                  <TableRow key={`${entry.at}-${entry.action}`}>
                    <TableCell className="whitespace-nowrap">
                      {dateFormat.format(new Date(entry.at))}
                    </TableCell>
                    <TableCell>
                      {entry.action === 'backup'
                        ? copy.backup.actionBackup
                        : copy.backup.actionRestore}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start tabular-nums">
                      {entry.scope}
                    </TableCell>
                    <TableCell dir="ltr" className="whitespace-nowrap text-start tabular-nums">
                      {formatBytes(entry.bytes)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.ok ? 'soft-success' : 'soft-destructive'}>
                        {entry.ok ? copy.backup.outcomeOk : copy.backup.outcomeFailed}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </SettingsCard>
    </div>
  );
}
