'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Clock, ImageIcon, MapPin, Phone, Trash2, Upload } from 'lucide-react';
import {
  ApiRequestError,
  getMunicipalitySettings,
  logApiError,
  updateMunicipalitySettings,
} from '@/lib/api-client';
import type { MunicipalitySettings } from '@/lib/api-client';
import { useSettingsSlice } from '@/lib/settings-store';
import type { SettingsCopy } from '@/lib/settings-i18n';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { LocalOnlyNotice, SaveBar, SettingsCard, SettingsField, SettingsGrid } from './settings-ui';

/** Fields `PATCH /fees/settings` accepts — the half of this form that persists. */
interface ServerProfile {
  contactPhone: string;
  whatsappNumber: string;
  cashOfficeHours: string;
  cashOfficeAddress: string;
}

/**
 * Fields with no column behind them yet.
 *
 * `nameAr`/`nameEn` do exist on the *registry* as tenant configuration, but
 * read-only to this app — `GET /tenant/config` serves them and nothing accepts
 * a write, so editing them here would be a form that lies. They are held with
 * the rest until a `PATCH /tenant/config` exists.
 */
interface LocalProfile {
  nameAr: string;
  nameEn: string;
  email: string;
  website: string;
  governorate: string;
  district: string;
  town: string;
  /** A data: URI. See the note on `readLogo` for why it is not a URL. */
  logoDataUri: string;
}

const EMPTY_SERVER: ServerProfile = {
  contactPhone: '',
  whatsappNumber: '',
  cashOfficeHours: '',
  cashOfficeAddress: '',
};

const EMPTY_LOCAL: LocalProfile = {
  nameAr: '',
  nameEn: '',
  email: '',
  website: '',
  governorate: '',
  district: '',
  town: '',
  logoDataUri: '',
};

/** 500 KB. A municipal crest is a few tens of KB; past this it is a photograph. */
const MAX_LOGO_BYTES = 500 * 1024;

function toServerProfile(settings: MunicipalitySettings): ServerProfile {
  return {
    contactPhone: settings.contactPhone ?? '',
    whatsappNumber: settings.whatsappNumber ?? '',
    cashOfficeHours: settings.cashOfficeHours ?? '',
    cashOfficeAddress: settings.cashOfficeAddress ?? '',
  };
}

/**
 * الملف الشخصي للبلدية — who this municipality is, as the portal states it.
 *
 * Split down the middle by what can actually be stored. The contact block and
 * the office block go to `PATCH /fees/settings`, which has held them since
 * migration 0012; identity, region and logo are kept in the browser and say so.
 * Both halves are edited in one form and saved by one button, because the split
 * is an accident of the backend's age and not something an administrator should
 * have to think about — but the notice above the local half means nobody
 * mistakes one for the other.
 */
export function ProfileSection({
  tenant,
  token,
  copy,
}: {
  tenant: string;
  token: string;
  copy: SettingsCopy;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [savedServer, setSavedServer] = useState<ServerProfile | null>(null);
  const [server, setServer] = useState<ServerProfile>(EMPTY_SERVER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    value: local,
    setValue: setLocal,
    persist: persistLocal,
    hydrated,
  } = useSettingsSlice<LocalProfile>(tenant, 'profile', EMPTY_LOCAL);
  const [savedLocal, setSavedLocal] = useState<LocalProfile>(EMPTY_LOCAL);

  useEffect(() => {
    if (hydrated) setSavedLocal(local);
    // Only when hydration flips — afterwards `local` is the live draft, and
    // tracking it here would make the form permanently look already-saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMunicipalitySettings(tenant, token);
        if (cancelled) return;
        const next = toServerProfile(result);
        setSavedServer(next);
        setServer(next);
        setError(null);
      } catch (caught) {
        logApiError(caught);
        if (!cancelled) {
          setError(
            caught instanceof ApiRequestError ? caught.message : copy.common.loadError,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, token, copy.common.loadError]);

  const dirty = useMemo(() => {
    if (!savedServer || !hydrated) return false;
    return (
      JSON.stringify(server) !== JSON.stringify(savedServer) ||
      JSON.stringify(local) !== JSON.stringify(savedLocal)
    );
  }, [server, savedServer, local, savedLocal, hydrated]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await updateMunicipalitySettings(tenant, token, server);
      const next = toServerProfile(result);
      setSavedServer(next);
      setServer(next);
      persistLocal(local);
      setSavedLocal(local);
      toast.success(copy.common.saved);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      const message =
        caught instanceof ApiRequestError ? caught.message : copy.common.saveError;
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [tenant, token, server, local, persistLocal, toast, copy.common]);

  const discard = useCallback(() => {
    if (savedServer) setServer(savedServer);
    setLocal(savedLocal);
  }, [savedServer, savedLocal, setLocal]);

  /**
   * Reads the chosen file into a data: URI.
   *
   * There is no upload endpoint and no object store configured for this app, so
   * a URL would have nowhere to point. Inlining keeps the preview honest — what
   * is shown is what is stored — at the cost of a size ceiling, which a crest
   * comfortably fits under and a photograph does not, which is the right way
   * round.
   */
  const readLogo = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error(copy.profile.logoWrongType);
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        toast.error(copy.profile.logoTooLarge, { description: copy.profile.logoConstraints });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setLocal({ ...local, logoDataUri: reader.result });
        }
      };
      reader.readAsDataURL(file);
    },
    [local, setLocal, toast, copy.profile],
  );

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
        icon={Building2}
        title={copy.profile.identityHeading}
        hint={copy.profile.identityHint}
      >
        <SettingsGrid>
          <SettingsField label={copy.profile.nameAr} htmlFor="name-ar" hint={copy.profile.nameArHint}>
            <Input
              id="name-ar"
              dir="rtl"
              value={local.nameAr}
              onChange={(e) => setLocal({ ...local, nameAr: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.nameEn} htmlFor="name-en" hint={copy.profile.nameEnHint}>
            <Input
              id="name-en"
              dir="ltr"
              className="text-start"
              value={local.nameEn}
              onChange={(e) => setLocal({ ...local, nameEn: e.target.value })}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsCard>

      <SettingsCard
        icon={ImageIcon}
        title={copy.profile.logoHeading}
        hint={copy.profile.logoHint}
      >
        {/*
          `items-center` only once the row survives wrapping. Stacked on a
          phone, a centred column puts the buttons under the middle of a 96px
          tile with the text ragged around them; `items-start` keeps everything
          on the reading edge until there is room for a real row.
        */}
        <div className="flex flex-wrap items-start gap-5 sm:items-center">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-muted/40">
            {local.logoDataUri ? (
              /*
                A plain <img>, not next/image: the source is a data: URI the
                administrator just chose, so there is nothing for the optimiser
                to fetch, resize or cache, and `next/image` would need the host
                allow-listed for a URL that has no host.
              */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={local.logoDataUri}
                alt={copy.profile.logoAlt}
                className="size-full object-contain"
              />
            ) : (
              <span className="px-2 text-center text-xs text-muted-foreground">
                {copy.profile.logoEmpty}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <Upload className="size-4" aria-hidden />
                {local.logoDataUri ? copy.profile.logoReplace : copy.profile.logoUpload}
              </Button>
              {local.logoDataUri ? (
                <Button
                  variant="ghost"
                  onClick={() => setLocal({ ...local, logoDataUri: '' })}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {copy.profile.logoRemove}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{copy.profile.logoConstraints}</p>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readLogo(file);
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = '';
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Phone}
        title={copy.profile.contactHeading}
        hint={copy.profile.contactHint}
      >
        <SettingsGrid>
          <SettingsField label={copy.profile.phone} htmlFor="phone" hint={copy.profile.phoneHint}>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-start"
              value={server.contactPhone}
              onChange={(e) => setServer({ ...server, contactPhone: e.target.value })}
            />
          </SettingsField>
          <SettingsField
            label={copy.profile.whatsapp}
            htmlFor="whatsapp"
            hint={copy.profile.whatsappHint}
          >
            <Input
              id="whatsapp"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-start"
              value={server.whatsappNumber}
              onChange={(e) => setServer({ ...server, whatsappNumber: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.email} htmlFor="email">
            <Input
              id="email"
              type="email"
              dir="ltr"
              className="text-start"
              value={local.email}
              onChange={(e) => setLocal({ ...local, email: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.website} htmlFor="website">
            <Input
              id="website"
              type="url"
              dir="ltr"
              className="text-start"
              placeholder="https://"
              value={local.website}
              onChange={(e) => setLocal({ ...local, website: e.target.value })}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsCard>

      <SettingsCard
        icon={MapPin}
        title={copy.profile.regionHeading}
        hint={copy.profile.regionHint}
      >
        <SettingsGrid columns={3}>
          <SettingsField label={copy.profile.governorate} htmlFor="governorate">
            <Input
              id="governorate"
              value={local.governorate}
              onChange={(e) => setLocal({ ...local, governorate: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.district} htmlFor="district">
            <Input
              id="district"
              value={local.district}
              onChange={(e) => setLocal({ ...local, district: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.town} htmlFor="town">
            <Input
              id="town"
              value={local.town}
              onChange={(e) => setLocal({ ...local, town: e.target.value })}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsCard>

      <SettingsCard
        icon={Clock}
        title={copy.profile.officeHeading}
        hint={copy.profile.officeHint}
      >
        <SettingsGrid>
          <SettingsField label={copy.profile.officeHours} htmlFor="office-hours">
            <Input
              id="office-hours"
              placeholder={copy.profile.officeHoursPlaceholder}
              value={server.cashOfficeHours}
              onChange={(e) => setServer({ ...server, cashOfficeHours: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.officeAddress} htmlFor="office-address">
            <Input
              id="office-address"
              placeholder={copy.profile.officeAddressPlaceholder}
              value={server.cashOfficeAddress}
              onChange={(e) => setServer({ ...server, cashOfficeAddress: e.target.value })}
            />
          </SettingsField>
        </SettingsGrid>
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
