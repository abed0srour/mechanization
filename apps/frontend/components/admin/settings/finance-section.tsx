'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Coins, Percent, Smartphone } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getMunicipalitySettings,
  logApiError,
  updateMunicipalitySettings,
} from '@/lib/api-client';
import type { MunicipalitySettings } from '@/lib/api-client';
import { CURRENCY_NAMES, type SettingsCopy } from '@/lib/settings-i18n';
import { CURRENCY_CODES as CURRENCIES, type CurrencyCode } from '@mechanization/shared-schemas';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  AlignedFieldGrid,
  SectionSaveRow,
  SettingsCard,
  FieldGroup,
  SettingsField,
} from './settings-ui';

const FREQUENCIES = ['ONCE', 'MONTHLY', 'HALF_YEARLY', 'ANNUALLY'] as const;

/**
 * The finance form's working copy.
 *
 * The numeric fields are held as **strings** even though the endpoint takes
 * numbers. A number in state cannot represent the states a text input passes
 * through on the way to a value: `''` while it is being cleared, `'1.'` while a
 * decimal is being typed. Parsing on each keystroke turns an emptied field into
 * `0` under the cursor and makes the box impossible to type a new figure into.
 * They are parsed once, at save, where a bad value is a validation error rather
 * than a fight with the caret.
 */
interface FinanceDraft {
  whishMoneyNumber: string;
  defaultFrequency: (typeof FREQUENCIES)[number];
  dueDays: string;
  priceDisplay: 'compact' | 'exact';
  defaultRatePercent: string;
  baseCurrency: CurrencyCode;
  /** `''` is "none" — a municipality quoting only in LBP is the common case. */
  secondaryCurrency: CurrencyCode | '';
  exchangeRate: string;
  /** Read-only here: the server stamps it, and only when the rate changes. */
  exchangeRateUpdatedAt: string;
}

const EMPTY: FinanceDraft = {
  whishMoneyNumber: '',
  defaultFrequency: 'ANNUALLY',
  dueDays: '30',
  priceDisplay: 'compact',
  defaultRatePercent: '0',
  baseCurrency: 'LBP',
  secondaryCurrency: '',
  exchangeRate: '',
  exchangeRateUpdatedAt: '',
};

function toDraft(settings: MunicipalitySettings): FinanceDraft {
  return {
    whishMoneyNumber: settings.whishMoneyNumber ?? '',
    defaultFrequency: settings.defaultFeeFrequency,
    dueDays: String(settings.defaultDueDays),
    priceDisplay: settings.priceDisplay,
    defaultRatePercent: String(settings.defaultRatePercent),
    baseCurrency: settings.baseCurrency,
    secondaryCurrency: settings.secondaryCurrency ?? '',
    exchangeRate: settings.exchangeRate === null ? '' : String(settings.exchangeRate),
    exchangeRateUpdatedAt: settings.exchangeRateUpdatedAt ?? '',
  };
}

/** A round figure to demonstrate the rate against — never a stored value. */
const RATE_PREVIEW_BASE = 1_000_000;

/** `'12.5'` → `12.5`, and anything unparseable → `null`. */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatAmount(amount: number, currency: CurrencyCode): string {
  // LBP has no minor unit in practice; the other two do.
  const digits = currency === 'LBP' ? 0 : 2;
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

/**
 * المالية — what a new invoice assumes before anyone edits it.
 *
 * Everything here is a *default*, and the section says so twice: once in the
 * card hint and once beside the rate. That distinction is the whole risk of
 * this screen — an administrator who believes changing the rate re-prices the
 * ledger has been misled into thinking they fixed something they did not, and
 * the fees already issued carry their own rate by design.
 *
 * The Whish number moved here from the old flat settings form — it is a payment
 * channel, not a contact detail. Everything else got its column in migration
 * 0015 and saves through the same `PATCH /fees/settings`.
 *
 * `exchangeRateUpdatedAt` is never written by this form. The server stamps it,
 * and only when the rate actually moves: a browser's clock is not evidence of
 * when a value was accepted, and re-saving an unchanged rate must not make a
 * month-old figure look refreshed.
 */
export function FinanceSection({
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

  const [saved, setSaved] = useState<FinanceDraft | null>(null);
  const [local, setLocal] = useState<FinanceDraft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMunicipalitySettings(tenant, token);
        if (cancelled) return;
        const next = toDraft(result);
        setSaved(next);
        setLocal(next);
        setError(null);
      } catch (caught) {
        logApiError(caught);
        if (!cancelled) {
          setError(caught instanceof ApiRequestError ? caught.message : copy.common.loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, token, copy.common.loadError]);

  const rate = parseNumber(local.defaultRatePercent);
  const rateValid = rate !== null && rate >= 0 && rate <= 100;
  const exchange = parseNumber(local.exchangeRate);
  const exchangeValid = !local.secondaryCurrency || (exchange !== null && exchange > 0);
  const dueDays = parseNumber(local.dueDays);
  const dueDaysValid = dueDays !== null && Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 365;

  const dirty = useMemo(
    () => saved !== null && JSON.stringify(local) !== JSON.stringify(saved),
    [local, saved],
  );

  const save = useCallback(async () => {
    if (!rateValid) {
      toast.error(copy.finance.invalidRate);
      return;
    }
    if (!exchangeValid) {
      toast.error(copy.finance.invalidExchange);
      return;
    }
    if (!dueDaysValid) {
      toast.error(copy.finance.invalidDueDays);
      return;
    }

    setSaving(true);
    try {
      const result = await updateMunicipalitySettings(tenant, token, {
        whishMoneyNumber: local.whishMoneyNumber,
        defaultFeeFrequency: local.defaultFrequency,
        defaultDueDays: dueDays,
        priceDisplay: local.priceDisplay,
        defaultRatePercent: rate,
        baseCurrency: local.baseCurrency,
        // `null`, not omitted: "no secondary currency" is a value to store, and
        // leaving the key out would mean "keep whatever is there".
        secondaryCurrency: local.secondaryCurrency === '' ? null : local.secondaryCurrency,
        exchangeRate: local.secondaryCurrency === '' ? null : exchange,
      });
      // `exchangeRateUpdatedAt` comes back from the server, which stamps it and
      // only when the rate actually moved — a browser clock is not evidence of
      // when a value was accepted, and re-saving an unchanged rate must not
      // make a month-old figure look fresh.
      const next = toDraft(result);
      setSaved(next);
      setLocal(next);
      toast.success(copy.common.saved);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      const message = caught instanceof ApiRequestError ? caught.message : copy.common.saveError;
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [
    tenant,
    token,
    local,
    rate,
    exchange,
    dueDays,
    rateValid,
    exchangeValid,
    dueDaysValid,
    toast,
    copy,
  ]);

  const discard = useCallback(() => {
    if (saved) setLocal(saved);
  }, [saved]);

  const currencyNames = CURRENCY_NAMES[locale === 'en' ? 'en' : 'ar'];
  const rateCharge = rateValid ? (RATE_PREVIEW_BASE * (rate ?? 0)) / 100 : 0;

  if (loading) {
    return <Skeleton className="h-[34rem] rounded-lg" />;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <SettingsCard icon={Coins} title={copy.finance.title} hint={copy.finance.description}>
        <div className="space-y-5">
          <FieldGroup icon={Coins} title={copy.finance.defaultsHeading}>
            <AlignedFieldGrid columns={3}>
              <SettingsField
                label={copy.finance.defaultFrequency}
                htmlFor="default-frequency"
                hint={copy.finance.defaultFrequencyHint}
              >
                <Select
                  value={local.defaultFrequency}
                  onValueChange={(next) =>
                    setLocal({ ...local, defaultFrequency: next as FinanceDraft['defaultFrequency'] })
                  }
                >
                  <SelectTrigger id="default-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        {ar.feeFrequency?.[frequency as never] ?? frequency}
                      </SelectItem>
                    ))}
                    {FREQUENCIES.map((frequency) => {
                      const label =
                        locale === 'en'
                          ? (frequency === 'ONCE'
                              ? 'One-time'
                              : frequency === 'MONTHLY'
                                ? 'Monthly'
                                : frequency === 'HALF_YEARLY'
                                  ? 'Semi-Annually'
                                  : 'Annually')
                          : (ar.feeFrequency?.[frequency as never] ?? frequency);
                      return (
                        <SelectItem key={frequency} value={frequency}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </SettingsField>

              <SettingsField
                label={copy.finance.dueDays}
                htmlFor="due-days"
                hint={copy.finance.dueDaysHint}
                error={dueDaysValid ? undefined : copy.finance.invalidDueDays}
              >
                <Input
                  id="due-days"
                  inputMode="numeric"
                  dir="ltr"
                  invalid={!dueDaysValid}
                  className="text-start"
                  value={local.dueDays}
                  onChange={(e) =>
                    setLocal({ ...local, dueDays: e.target.value.replace(/\D/g, '') })
                  }
                />
              </SettingsField>

              <SettingsField
                label={copy.finance.priceDisplay}
                htmlFor="price-display"
                hint={copy.finance.priceDisplayHint}
              >
                <Select
                  value={local.priceDisplay}
                  onValueChange={(next) =>
                    setLocal({ ...local, priceDisplay: next as FinanceDraft['priceDisplay'] })
                  }
                >
                  <SelectTrigger id="price-display">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">{copy.finance.priceDisplayCompact}</SelectItem>
                    <SelectItem value="exact">{copy.finance.priceDisplayExact}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsField>
            </AlignedFieldGrid>
          </FieldGroup>

          <FieldGroup icon={Percent} title={copy.finance.rateHeading}>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <AlignedFieldGrid columns={1}>
            <div className="grid items-start gap-5 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-6">
                <SettingsField
                  label={copy.finance.defaultRate}
                  htmlFor="default-rate"
                  hint={rateValid ? copy.finance.rateAppliesTo : undefined}
                  error={rateValid ? undefined : copy.finance.invalidRate}
                >
                  {/* `dir="ltr"` on the wrapper as well as the input: `end-3.5`
                      below is a logical property and resolves against this
                      div's own direction. Left off, it inherits the page's
                      RTL and pins the % sign to the physical left — the same
                      edge an ltr input's digits start from — so the suffix
                      and a two-digit rate would sit on top of each other. */}
                  <div className="relative" dir="ltr">
                    <Input
                      id="default-rate"
                      inputMode="decimal"
                      dir="ltr"
                      invalid={!rateValid}
                      className="pe-10 text-start"
                      className="pe-10 text-start font-mono font-medium"
                      value={local.defaultRatePercent}
                      onChange={(e) => setLocal({ ...local, defaultRatePercent: e.target.value })}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-sm text-muted-foreground"
                      className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-semibold text-muted-foreground"
                    >
                      %
                    </span>
                  </div>
                </SettingsField>
              </AlignedFieldGrid>

              {/*
                A worked example rather than a bare percentage. "10%" of what,
                added to what, is the question an administrator is actually
                answering, and a figure they can check against a fee they know
                is how they answer it.
              */}
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="leading-snug text-muted-foreground">
                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">{locale === 'en' ? 'Quick presets:' : 'خيارات سريعة:'}</span>
                  {['0', '5', '10', '15', '20'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setLocal({ ...local, defaultRatePercent: preset })}
                      className={cn(
                        'rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                        local.defaultRatePercent === preset
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border/60 bg-muted/40 hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Rate Breakdown Card */}
              <div className="flex flex-col gap-1.5 lg:col-span-6">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {copy.finance.ratePreview}
                </Label>
                <dl className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="min-w-0 text-muted-foreground">
                      {copy.finance.ratePreviewBase}
                    </dt>
                    <dd className="shrink-0 tabular-nums" dir="ltr">
                      {formatAmount(RATE_PREVIEW_BASE, local.baseCurrency)}
                    </dd>
                <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 text-sm shadow-sm backdrop-blur-sm">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs">{copy.finance.ratePreviewBase}</span>
                      <span className="font-mono text-xs tabular-nums" dir="ltr">
                        {formatAmount(RATE_PREVIEW_BASE, local.baseCurrency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {copy.finance.ratePreviewCharge}
                        <span className="inline-flex rounded bg-primary/15 px-1.5 py-0.2 text-[11px] font-semibold text-primary">
                          +{rateValid ? rate : 0}%
                        </span>
                      </span>
                      <span className="font-mono text-xs font-semibold text-primary tabular-nums" dir="ltr">
                        +{formatAmount(rateCharge, local.baseCurrency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/60 pt-2 text-sm font-bold">
                      <span>{copy.finance.ratePreviewTotal}</span>
                      <span className="font-mono text-base text-foreground tabular-nums" dir="ltr">
                        {formatAmount(RATE_PREVIEW_BASE + rateCharge, local.baseCurrency)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="min-w-0 text-muted-foreground">
                      {copy.finance.ratePreviewCharge}
                    </dt>
                    <dd className="shrink-0 tabular-nums" dir="ltr">
                      {formatAmount(rateCharge, local.baseCurrency)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t pt-2 font-semibold">
                    <dt className="min-w-0">{copy.finance.ratePreviewTotal}</dt>
                    <dd className="shrink-0 tabular-nums" dir="ltr">
                      {formatAmount(RATE_PREVIEW_BASE + rateCharge, local.baseCurrency)}
                    </dd>
                  </div>
                </dl>
                </div>
              </div>
            </div>
          </FieldGroup>

          <FieldGroup icon={ArrowLeftRight} title={copy.finance.currencyHeading}>
            <AlignedFieldGrid>
              <SettingsField
                label={copy.finance.baseCurrency}
                htmlFor="base-currency"
                hint={copy.finance.baseCurrencyHint}
              >
                <Select
                  value={local.baseCurrency}
                  onValueChange={(next) => setLocal({ ...local, baseCurrency: next as CurrencyCode })}
                >
                  <SelectTrigger id="base-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {currencyNames[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>

              <SettingsField
                label={copy.finance.secondaryCurrency}
                htmlFor="secondary-currency"
                hint={copy.finance.secondaryCurrencyHint}
              >
                <Select
                  // Radix rejects `''` as an item value, so "none" travels as a
                  // sentinel and is mapped back at the boundary.
                  value={local.secondaryCurrency || 'NONE'}
                  onValueChange={(next) =>
                    setLocal({
                      ...local,
                      secondaryCurrency: next === 'NONE' ? '' : (next as CurrencyCode),
                    })
                  }
                >
                  <SelectTrigger id="secondary-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{copy.finance.secondaryNone}</SelectItem>
                    {CURRENCIES.filter((code) => code !== local.baseCurrency).map((code) => (
                      <SelectItem key={code} value={code}>
                        {currencyNames[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>
            </AlignedFieldGrid>

            {local.secondaryCurrency ? (
              <div className="grid items-start gap-4 md:grid-cols-2">
                <AlignedFieldGrid columns={1}>
              <div className="mt-3 grid items-start gap-5 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <SettingsField
                    label={copy.finance.exchangeRate}
                    htmlFor="exchange-rate"
                    hint={copy.finance.exchangeRateHint}
                    error={exchangeValid ? undefined : copy.finance.invalidExchange}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-sm text-muted-foreground" dir="ltr">
                      <span className="shrink-0 rounded-md bg-muted px-2.5 py-2 text-xs font-semibold text-muted-foreground" dir="ltr">
                        1 {local.secondaryCurrency} =
                      </span>
                      <Input
                        id="exchange-rate"
                        inputMode="decimal"
                        dir="ltr"
                        invalid={!exchangeValid}
                        className="text-start"
                        className="text-start font-mono font-medium"
                        value={local.exchangeRate}
                        onChange={(e) => setLocal({ ...local, exchangeRate: e.target.value })}
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">
                      <span className="shrink-0 rounded-md bg-muted px-2.5 py-2 text-xs font-semibold text-muted-foreground">
                        {local.baseCurrency}
                      </span>
                    </div>
                  </SettingsField>
                </AlignedFieldGrid>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label className="leading-snug text-muted-foreground">
                <div className="flex flex-col gap-1.5 lg:col-span-6">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {copy.finance.conversionPreview}
                  </Label>
                  <div className="rounded-md border bg-muted/30 p-3">
                    {/* `break-words`: near parity this line runs to two full
                        amounts plus a currency code each, which overflows the
                        panel on a phone rather than wrapping — it has no spaces
                        the browser likes to break at. */}
                    <p className="break-words text-sm tabular-nums" dir="ltr">
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4 shadow-sm">
                    <p className="break-words font-mono text-sm font-semibold tabular-nums" dir="ltr">
                      {exchangeValid && exchange
                        ? `${formatAmount(RATE_PREVIEW_BASE, local.baseCurrency)} ≈ ${formatAmount(
                            RATE_PREVIEW_BASE / exchange,
                            local.secondaryCurrency,
                          )}`
                        : '—'}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <p className="mt-2 text-xs text-muted-foreground">
                      {copy.finance.exchangeRateUpdated}:{' '}
                      {local.exchangeRateUpdatedAt
                        ? new Date(local.exchangeRateUpdatedAt).toLocaleString(
                            locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn',
                          )
                        : copy.finance.exchangeRateNever}
                      <span className="font-medium text-foreground">
                        {local.exchangeRateUpdatedAt
                          ? new Date(local.exchangeRateUpdatedAt).toLocaleString(
                              locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn',
                            )
                          : copy.finance.exchangeRateNever}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </FieldGroup>

          <FieldGroup icon={Smartphone} title={copy.finance.whishHeading}>
            <AlignedFieldGrid>
              <SettingsField
                label={copy.finance.whishNumber}
                htmlFor="whish-number"
                hint={copy.finance.whishHint}
              >
                <Input
                  id="whish-number"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  className="text-start"
                  value={local.whishMoneyNumber}
                  onChange={(e) => setLocal({ ...local, whishMoneyNumber: e.target.value })}
                />
              </SettingsField>
            </AlignedFieldGrid>
          </FieldGroup>
        </div>

        <SectionSaveRow
          copy={copy}
          dirty={dirty}
          saving={saving}
          onSave={() => void save()}
          onDiscard={discard}
        />
      </SettingsCard>
    </div>
  );
}
