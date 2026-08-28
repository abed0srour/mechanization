'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Hash, TriangleAlert } from 'lucide-react';
import { useSettingsSlice } from '@/lib/settings-store';
import { SEQUENCE_KEYS, type SequenceKey, type SettingsCopy } from '@/lib/settings-i18n';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { LocalOnlyNotice, SaveBar, SettingsCard } from './settings-ui';

/** One document type's reference format. Strings, because these are inputs. */
interface Sequence {
  prefix: string;
  nextNumber: string;
  padding: string;
}

type NumberingSettings = Record<SequenceKey, Sequence>;

const DEFAULTS: NumberingSettings = {
  invoice: { prefix: 'MUN-INV-', nextNumber: '1001', padding: '5' },
  serviceOrder: { prefix: 'MUN-SRV-', nextNumber: '1', padding: '5' },
  permit: { prefix: 'MUN-PRM-', nextNumber: '1', padding: '5' },
  taxReceipt: { prefix: 'MUN-RCP-', nextNumber: '1', padding: '6' },
  refund: { prefix: 'MUN-REF-', nextNumber: '1', padding: '4' },
};

const MAX_PADDING = 12;

/** `MUN-INV-`, `42`, `5` → `MUN-INV-00042`. */
export function formatReference(prefix: string, value: number, padding: number): string {
  return `${prefix}${String(Math.max(value, 0)).padStart(Math.max(padding, 1), '0')}`;
}

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * تسلسل الترقيم — how each issued document gets its reference.
 *
 * Five independent counters rather than one shared one. A municipality reading
 * «كم رخصة أصدرنا هذا العام» wants the permit counter to answer it, and a single
 * sequence shared across invoices, receipts and permits answers nothing — the
 * numbers only tell you how many documents of *all* kinds were issued.
 *
 * The preview is not decoration. Prefix, counter and padding compose into a
 * string whose shape is not obvious from three separate inputs — a padding of 4
 * against a next number of 10001 silently produces a *five*-digit reference,
 * and the only way an administrator sees that before it is printed on a permit
 * is to be shown the result.
 *
 * Browser-held: there is no sequence table on the backend, and no issuer reads
 * these yet. What is configured here describes the intended format; wiring it
 * to document creation is a backend change, not a settings one.
 */
export function NumberingSection({
  tenant,
  copy,
}: {
  tenant: string;
  copy: SettingsCopy;
}) {
  const toast = useToast();

  const {
    value: sequences,
    setValue: setSequences,
    persist,
    hydrated,
  } = useSettingsSlice<NumberingSettings>(tenant, 'numbering', DEFAULTS);
  const [saved, setSaved] = useState<NumberingSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hydrated) setSaved(sequences);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const dirty = useMemo(
    () => hydrated && JSON.stringify(sequences) !== JSON.stringify(saved),
    [sequences, saved, hydrated],
  );

  /**
   * Prefixes used by more than one sequence.
   *
   * Not an error — two sequences may legitimately share a prefix if the
   * municipality wants one visible series — but it is almost always a
   * copy-paste left unfinished, and the consequence (two different documents
   * carrying `MUN-00042`) is discovered at an inconvenient moment.
   */
  const duplicatePrefixes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const key of SEQUENCE_KEYS) {
      const prefix = sequences[key].prefix.trim().toUpperCase();
      if (!prefix) continue;
      seen.set(prefix, (seen.get(prefix) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([prefix]) => prefix));
  }, [sequences]);

  const invalid = useMemo(() => {
    const problems = new Map<SequenceKey, { next?: string; padding?: string }>();
    for (const key of SEQUENCE_KEYS) {
      const next = parseInteger(sequences[key].nextNumber);
      const padding = parseInteger(sequences[key].padding);
      const entry: { next?: string; padding?: string } = {};
      if (next === null || next < 1) entry.next = copy.numbering.invalidNext;
      if (padding === null || padding < 1 || padding > MAX_PADDING) {
        entry.padding = copy.numbering.invalidPadding;
      }
      if (entry.next || entry.padding) problems.set(key, entry);
    }
    return problems;
  }, [sequences, copy.numbering]);

  const update = useCallback(
    (key: SequenceKey, patch: Partial<Sequence>) => {
      setSequences({ ...sequences, [key]: { ...sequences[key], ...patch } });
    },
    [sequences, setSequences],
  );

  const save = useCallback(() => {
    if (invalid.size > 0) {
      toast.error(copy.common.saveError, { description: copy.numbering.invalidNext });
      return;
    }
    setSaving(true);
    persist(sequences);
    setSaved(sequences);
    setSaving(false);
    toast.success(copy.common.saved);
  }, [invalid, sequences, persist, toast, copy]);

  return (
    <div className="space-y-6">
      <LocalOnlyNotice copy={copy} />

      <SettingsCard
        icon={Hash}
        title={copy.numbering.heading}
        hint={copy.numbering.hint}
      >
        <div className="space-y-5">
          {SEQUENCE_KEYS.map((key) => {
            const sequence = sequences[key];
            const problems = invalid.get(key);
            const next = parseInteger(sequence.nextNumber);
            const padding = parseInteger(sequence.padding);
            const previewable = next !== null && padding !== null && padding >= 1;
            const duplicate = duplicatePrefixes.has(sequence.prefix.trim().toUpperCase());

            return (
              <div
                key={key}
                className="rounded-xl border border-border/70 bg-muted/20 p-5"
              >
                <div className="flex items-start gap-2.5">
                  <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-medium">{copy.numbering.documents[key]}</p>
                    <p className="text-xs text-muted-foreground">
                      {copy.numbering.documentHints[key]}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr]">
                  <Field label={copy.numbering.prefix} htmlFor={`${key}-prefix`}>
                    <Input
                      id={`${key}-prefix`}
                      dir="ltr"
                      className="text-start font-mono"
                      value={sequence.prefix}
                      /* Uppercased and stripped as it is typed: a reference is
                         read back against a printed document, and `mun-inv-`
                         beside `MUN-INV-` is a difference a clerk should never
                         have to notice. */
                      onChange={(e) =>
                        update(key, {
                          prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                        })
                      }
                    />
                  </Field>

                  <Field
                    label={copy.numbering.nextNumber}
                    htmlFor={`${key}-next`}
                    error={problems?.next}
                  >
                    <Input
                      id={`${key}-next`}
                      inputMode="numeric"
                      dir="ltr"
                      invalid={Boolean(problems?.next)}
                      className="text-start font-mono"
                      value={sequence.nextNumber}
                      onChange={(e) =>
                        update(key, { nextNumber: e.target.value.replace(/\D/g, '') })
                      }
                    />
                  </Field>

                  <Field
                    label={copy.numbering.padding}
                    htmlFor={`${key}-padding`}
                    error={problems?.padding}
                  >
                    <Input
                      id={`${key}-padding`}
                      inputMode="numeric"
                      dir="ltr"
                      invalid={Boolean(problems?.padding)}
                      className="text-start font-mono"
                      value={sequence.padding}
                      onChange={(e) =>
                        update(key, { padding: e.target.value.replace(/\D/g, '').slice(0, 2) })
                      }
                    />
                  </Field>

                  {/*
                    Two consecutive references, not one. A single sample looks
                    correct in every configuration; it takes the second to show
                    that a counter about to cross its padding width will widen
                    the reference mid-series.
                  */}
                  <div className="rounded-lg border border-border/70 bg-card p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {copy.numbering.preview}
                    </p>
                    {previewable ? (
                      <div className="mt-1.5 space-y-1 font-mono text-sm" dir="ltr">
                        <p className="truncate">
                          {formatReference(sequence.prefix, next, padding)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatReference(sequence.prefix, next + 1, padding)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                </div>

                {duplicate ? (
                  <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {copy.numbering.collision}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SaveBar
        copy={copy}
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setSequences(saved)}
      />
    </div>
  );
}
