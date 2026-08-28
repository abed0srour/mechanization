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
import { useSettingsSlice } from '@/lib/settings-store';
import { CURRENCIES, CURRENCY_NAMES, type CurrencyCode, type SettingsCopy } from '@/lib/settings-i18n';

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
import { LocalOnlyNotice, SaveBar, SettingsCard, SettingsField, SettingsGrid } from './settings-ui';

const FREQUENCIES = ['ONCE', 'MONTHLY', 'HALF_YEARLY', 'ANNUALLY'] as const;

/** The one finance field the server already holds — see migration 0009. */
interface ServerFinance {
  whishMoneyNumber: string;
}

interface LocalFinance {
  defaultFrequency: (typeof FREQUENCIES)[number];
  /** Days from issue to due date. Stored as a string: it is a text input, and
   *  parsing on every keystroke makes an empty field impossible to type into. */
  dueDays: string;
  priceDisplay: 'compact' | 'exact';
  defaultRatePercent: string;
  baseCurrency: CurrencyCode;
  /** `''` is "none" — a municipality quoting only in LBP is the common case. */
  secondaryCurrency: CurrencyCode | '';
  exchangeRate: string;
  /** ISO timestamp of the last exchange-rate edit, or `''`. */
  exchangeRateUpdatedAt: string;
}

const EMPTY_SERVER: ServerFinance = { whishMoneyNumber: '' };

const DEFAULT_LOCAL: LocalFinance = {
  defaultFrequency: 'ANNUALLY',
  dueDays: '30',
  priceDisplay: 'compact',
  defaultRatePercent: '0',
  baseCurrency: 'LBP',
  secondaryCurrency: '',
  exchangeRate: '',
  exchangeRateUpdatedAt: '',
};

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
 * The Whish number is the one field with a column behind it (it moved here from
 * the old flat settings form — it is a payment channel, not a contact detail).
 * The rest is browser-held; see `settings-store`.
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

  const [savedServer, setSavedServer] = useState<ServerFinance | null>(null);
  const [server, setServer] = useState<ServerFinance>(EMPTY_SERVER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    value: local,
    setValue: setLocal,
    persist: persistLocal,
    hydrated,
  } = useSettingsSlice<LocalFinance>(tenant, 'finance', DEFAULT_LOCAL);
  const [savedLocal, setSavedLocal] = useState<LocalFinance>(DEFAULT_LOCAL);

  useEffect(() => {
    if (hydrated) setSavedLocal(local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMunicipalitySettings(tenant, token);
        if (cancelled) return;
        const next: ServerFinance = { whishMoneyNumber: result.whishMoneyNumber ?? '' };
        setSavedServer(next);
        setServer(next);
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

  const dirty = useMemo(() => {
    if (!savedServer || !hydrated) return false;
    return (
      JSON.stringify(server) !== JSON.stringify(savedServer) ||
      JSON.stringify(local) !== JSON.stringify(savedLocal)
    );
  }, [server, savedServer, local, savedLocal, hydrated]);

  const save = useCallback(async () => {
    if (!rateValid) {
      toast.error(copy.finance.invalidRate);
      return;
    }
    if (!exchangeValid) {
      toast.error(copy.finance.invalidExchange);
      return;
    }

    setSaving(true);
    try {
      const result = await updateMunicipalitySettings(tenant, token, {
        whishMoneyNumber: server.whishMoneyNumber,
      });
      const nextServer: ServerFinance = { whishMoneyNumber: result.whishMoneyNumber ?? '' };
      setSavedServer(nextServer);
      setServer(nextServer);

      // Stamped at save, not at keystroke: the timestamp answers "how stale is
      // this rate", and a value typed but never saved has no staleness at all.
      const rateChanged = local.exchangeRate !== savedLocal.exchangeRate;
      const nextLocal: LocalFinance = rateChanged
        ? { ...local, exchangeRateUpdatedAt: new Date().toISOString() }
        : local;

      persistLocal(nextLocal);
      setSavedLocal(nextLocal);
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
    server,
    local,
    savedLocal,
    persistLocal,
    rateValid,
    exchangeValid,
    toast,
    copy,
  ]);

  const discard = useCallback(() => {
    if (savedServer) setServer(savedServer);
    setLocal(savedLocal);
  }, [savedServer, savedLocal, setLocal]);

  const currencyNames = CURRENCY_NAMES[locale === 'en' ? 'en' : 'ar'];
  const rateCharge = rateValid ? (RATE_PREVIEW_BASE * (rate ?? 0)) / 100 : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-56 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LocalOnlyNotice copy={copy} />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <SettingsCard
        icon={Coins}
        title={copy.finance.defaultsHeading}
        hint={copy.finance.defaultsHint}
      >
        <SettingsGrid columns={3}>
          <SettingsField
            label={copy.finance.defaultFrequency}
            htmlFor="default-frequency"
            hint={copy.finance.defaultFrequencyHint}
          >
            <Select
              value={local.defaultFrequency}
              onValueChange={(next) =>
                setLocal({ ...local, defaultFrequency: next as LocalFinance['defaultFrequency'] })
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
              </SelectContent>
            </Select>
          </SettingsField>

          <SettingsField label={copy.finance.dueDays} htmlFor="due-days" hint={copy.finance.dueDaysHint}>
            <Input
              id="due-days"
              inputMode="numeric"
              dir="ltr"
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
                setLocal({ ...local, priceDisplay: next as LocalFinance['priceDisplay'] })
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
        </SettingsGrid>
      </SettingsCard>

      <SettingsCard
        icon={Percent}
        title={copy.finance.rateHeading}
        hint={copy.finance.rateHint}
      >
        <div className="grid items-start gap-5 md:grid-cols-2 md:gap-6">
          <div className="space-y-4">
            <SettingsField
              label={copy.finance.defaultRate}
              htmlFor="default-rate"
              hint={copy.finance.defaultRateHint}
              error={rateValid ? undefined : copy.finance.invalidRate}
            >
              <div className="relative">
                <Input
                  id="default-rate"
                  inputMode="decimal"
                  dir="ltr"
                  invalid={!rateValid}
                  className="pe-10 text-start"
                  value={local.defaultRatePercent}
                  onChange={(e) => setLocal({ ...local, defaultRatePercent: e.target.value })}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
            </SettingsField>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.finance.rateAppliesTo}
            </p>
          </div>

          {/*
            A worked example rather than a bare percentage. "10%" of what, added
            to what, is the question an administrator is actually answering, and
            a number they can check against a fee they know is how they answer it.

            Label above the panel, matching the field beside it, so the panel's
            top edge lands on the input's rather than on its label's.
          */}
          <div className="flex min-w-0 flex-col gap-2">
            <Label className="text-muted-foreground">{copy.finance.ratePreview}</Label>
            <dl className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 text-muted-foreground">{copy.finance.ratePreviewBase}</dt>
                <dd className="shrink-0 tabular-nums" dir="ltr">
                  {formatAmount(RATE_PREVIEW_BASE, local.baseCurrency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 text-muted-foreground">{copy.finance.ratePreviewCharge}</dt>
                <dd className="shrink-0 tabular-nums" dir="ltr">
                  {formatAmount(rateCharge, local.baseCurrency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-border/60 pt-2 font-semibold">
                <dt className="min-w-0">{copy.finance.ratePreviewTotal}</dt>
                <dd className="shrink-0 tabular-nums" dir="ltr">
                  {formatAmount(RATE_PREVIEW_BASE + rateCharge, local.baseCurrency)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={ArrowLeftRight}
        title={copy.finance.currencyHeading}
        hint={copy.finance.currencyHint}
      >
        <SettingsGrid>
          <SettingsField
            label={copy.finance.baseCurrency}
            htmlFor="base-currency"
            hint={copy.finance.baseCurrencyHint}
          >
            <Select
              value={local.baseCurrency}
              onValueChange={(next) =>
                setLocal({ ...local, baseCurrency: next as CurrencyCode })
              }
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
        </SettingsGrid>

        {local.secondaryCurrency ? (
          <div className="mt-5 grid items-start gap-5 border-t border-border/60 pt-5 md:grid-cols-2">
            <SettingsField
              label={copy.finance.exchangeRate}
              htmlFor="exchange-rate"
              hint={copy.finance.exchangeRateHint}
              error={exchangeValid ? undefined : copy.finance.invalidExchange}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-muted-foreground" dir="ltr">
                  1 {local.secondaryCurrency} =
                </span>
                <Input
                  id="exchange-rate"
                  inputMode="decimal"
                  dir="ltr"
                  invalid={!exchangeValid}
                  className="text-start"
                  value={local.exchangeRate}
                  onChange={(e) => setLocal({ ...local, exchangeRate: e.target.value })}
                />
                <span className="shrink-0 text-sm text-muted-foreground">
                  {local.baseCurrency}
                </span>
              </div>
            </SettingsField>

            <div className="flex min-w-0 flex-col gap-2">
              <Label className="text-muted-foreground">{copy.finance.conversionPreview}</Label>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                {/* `break-words`: at a rate near 1 this line runs to two full
                    amounts plus a currency code each, which overflows the panel
                    on a phone rather than wrapping, because it has no spaces
                    the browser likes to break at. */}
                <p className="break-words text-sm tabular-nums" dir="ltr">
                  {exchangeValid && exchange
                    ? `${formatAmount(RATE_PREVIEW_BASE, local.baseCurrency)} ≈ ${formatAmount(
                        RATE_PREVIEW_BASE / exchange,
                        local.secondaryCurrency,
                      )}`
                    : '—'}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {copy.finance.exchangeRateUpdated}:{' '}
                  {local.exchangeRateUpdatedAt
                    ? new Date(local.exchangeRateUpdatedAt).toLocaleString(
                        locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn',
                      )
                    : copy.finance.exchangeRateNever}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        icon={Smartphone}
        title={copy.finance.whishHeading}
        hint={copy.finance.whishHint}
      >
        <div className="sm:max-w-sm">
          <SettingsField label={copy.finance.whishNumber} htmlFor="whish-number">
            <Input
              id="whish-number"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-start"
              value={server.whishMoneyNumber}
              onChange={(e) => setServer({ ...server, whishMoneyNumber: e.target.value })}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SaveBar
        copy={copy}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={discard}
      />
    </div>
  );
}
