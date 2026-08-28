'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  History,
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
  updateMunicipalitySettings,
} from '@/lib/api-client';
import { useSettingsSlice } from '@/lib/settings-store';
import type { SettingsCopy } from '@/lib/settings-i18n';
import { createZip, downloadBlob, toCsv, type ZipEntry } from '@/lib/zip';
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
import { ScrollableTable, SettingsCard, SettingsField, SettingsGrid } from './settings-ui';
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
 * The restore half does not work and says so on the control. Reading the
 * archive back means writing rows across every table in the right order, which
 * is a server-side transaction — a browser cannot do it safely and should not
 * pretend to. The drop zone accepts and validates a file so the flow is real up
 * to the point where the server would take over.
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
  const [dragging, setDragging] = useState(false);
  const [archive, setArchive] = useState<File | null>(null);

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
          note: 'Tenant data export of API-exposed tables. Not a database dump.',
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
      // `entries.length - 1` excludes the manifest, which is not a table.
      scope: `${entries.length - 1}/${TABLES.length}`,
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

  const acceptArchive = useCallback(
    (file: File) => {
      const looksZipped =
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed' ||
        file.name.toLowerCase().endsWith('.zip');
      if (!looksZipped) {
        toast.error(copy.backup.wrongFormat);
        return;
      }
      setArchive(file);
    },
    [toast, copy.backup.wrongFormat],
  );

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={DatabaseBackup}
        title={copy.backup.manualHeading}
        hint={copy.backup.manualHint}
      >
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.backup.includes}
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {TABLES.map((table) => (
                <li key={table.key}>
                  <Badge variant="soft-muted">
                    {copy.backup.tables[table.key] ?? table.key}
                  </Badge>
                </li>
              ))}
            </ul>
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
        <SettingsGrid columns={4}>
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
        </SettingsGrid>

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
        hint={copy.backup.restoreHint}
      >
        {/*
          A real drop target, even though the button beyond it is disabled. The
          flow being reviewable — does the file land, is a wrong type caught, is
          the chosen name shown back — is the point of building this now; the
          transaction that writes the rows is a server change.
        */}
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
            if (file) acceptArchive(file);
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
          )}
        >
          {archive ? (
            <>
              <CheckCircle2 className="size-7 text-success" aria-hidden />
              <p className="mt-3 font-medium" dir="ltr">
                {archive.name}
              </p>
              <p className="text-xs text-muted-foreground">{formatBytes(archive.size)}</p>
              <Button variant="ghost" className="mt-3" onClick={() => setArchive(null)}>
                <Trash2 className="size-4" aria-hidden />
                {copy.backup.clearFile}
              </Button>
            </>
          ) : (
            <>
              <Upload className="size-7 text-muted-foreground" aria-hidden />
              <p className="mt-3 font-medium">{copy.backup.dropZone}</p>
              <p className="text-sm text-muted-foreground">{copy.backup.dropZoneHint}</p>
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
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) acceptArchive(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button disabled>{copy.backup.restoreSelected}</Button>
          <p className="text-xs text-muted-foreground">{copy.backup.restoreDisabled}</p>
        </div>
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
