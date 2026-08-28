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
import type { SettingsCopy } from '@/lib/settings-i18n';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SaveBar, SettingsCard, SettingsField, SettingsGrid } from './settings-ui';

/**
 * The profile fields, all of which `PATCH /fees/settings` now accepts.
 *
 * Strings throughout, including where the stored value is nullable: `''` is
 * what an emptied input holds, and the server reads it as "clear this". A
 * `null` in state would mean a controlled input turning uncontrolled the
 * moment a clerk deletes the last character of a phone number.
 */
interface Profile {
  contactPhone: string;
  whatsappNumber: string;
  cashOfficeHours: string;
  cashOfficeAddress: string;
  nameAr: string;
  nameEn: string;
  contactEmail: string;
  website: string;
  governorate: string;
  district: string;
  town: string;
  /** A data: URI. See the note on `readLogo` for why it is not a URL. */
  logoDataUri: string;
}

const EMPTY: Profile = {
  contactPhone: '',
  whatsappNumber: '',
  cashOfficeHours: '',
  cashOfficeAddress: '',
  nameAr: '',
  nameEn: '',
  contactEmail: '',
  website: '',
  governorate: '',
  district: '',
  town: '',
  logoDataUri: '',
};

/** 500 KB. A municipal crest is a few tens of KB; past this it is a photograph. */
const MAX_LOGO_BYTES = 500 * 1024;

function toProfile(settings: MunicipalitySettings): Profile {
  return {
    contactPhone: settings.contactPhone ?? '',
    whatsappNumber: settings.whatsappNumber ?? '',
    cashOfficeHours: settings.cashOfficeHours ?? '',
    cashOfficeAddress: settings.cashOfficeAddress ?? '',
    nameAr: settings.nameAr ?? '',
    nameEn: settings.nameEn ?? '',
    contactEmail: settings.contactEmail ?? '',
    website: settings.website ?? '',
    governorate: settings.governorate ?? '',
    district: settings.district ?? '',
    town: settings.town ?? '',
    logoDataUri: settings.logoDataUri ?? '',
  };
}

/**
 * الملف الشخصي للبلدية — who this municipality is, as the portal states it.
 *
 * All of it now saves to `PATCH /fees/settings`. Identity, region and the crest
 * were kept in the browser until migration 0015 gave them columns; they were
 * the wrong thing to hold locally, since the whole point of a municipality's
 * name and logo is that every clerk and every printed document agrees on them.
 *
 * The section sends only the twelve keys it owns. The endpoint writes only what
 * it is sent, so saving here cannot clear the exchange rate or the numbering
 * prefixes belonging to sections this form never rendered.
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

  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMunicipalitySettings(tenant, token);
        if (cancelled) return;
        const next = toProfile(result);
        setSaved(next);
        setDraft(next);
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

  const dirty = useMemo(
    () => saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await updateMunicipalitySettings(tenant, token, draft);
      const next = toProfile(result);
      // Re-seeded from the response, not from the draft: the server trims and
      // normalises, so echoing the draft back would leave the form looking
      // clean while holding a value the database does not have.
      setSaved(next);
      setDraft(next);
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
  }, [tenant, token, draft, toast, copy.common]);

  const discard = useCallback(() => {
    if (saved) setDraft(saved);
  }, [saved]);

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
          setDraft({ ...draft, logoDataUri: reader.result });
        }
      };
      reader.readAsDataURL(file);
    },
    [draft, toast, copy.profile],
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
              value={draft.nameAr}
              onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.nameEn} htmlFor="name-en" hint={copy.profile.nameEnHint}>
            <Input
              id="name-en"
              dir="ltr"
              className="text-start"
              value={draft.nameEn}
              onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
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
            {draft.logoDataUri ? (
              /*
                A plain <img>, not next/image: the source is a data: URI the
                administrator just chose, so there is nothing for the optimiser
                to fetch, resize or cache, and `next/image` would need the host
                allow-listed for a URL that has no host.
              */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.logoDataUri}
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
                {draft.logoDataUri ? copy.profile.logoReplace : copy.profile.logoUpload}
              </Button>
              {draft.logoDataUri ? (
                <Button
                  variant="ghost"
                  onClick={() => setDraft({ ...draft, logoDataUri: '' })}
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
              value={draft.contactPhone}
              onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })}
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
              value={draft.whatsappNumber}
              onChange={(e) => setDraft({ ...draft, whatsappNumber: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.email} htmlFor="email">
            <Input
              id="email"
              type="email"
              dir="ltr"
              className="text-start"
              value={draft.contactEmail}
              onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.website} htmlFor="website">
            <Input
              id="website"
              type="url"
              dir="ltr"
              className="text-start"
              placeholder="https://"
              value={draft.website}
              onChange={(e) => setDraft({ ...draft, website: e.target.value })}
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
              value={draft.governorate}
              onChange={(e) => setDraft({ ...draft, governorate: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.district} htmlFor="district">
            <Input
              id="district"
              value={draft.district}
              onChange={(e) => setDraft({ ...draft, district: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.town} htmlFor="town">
            <Input
              id="town"
              value={draft.town}
              onChange={(e) => setDraft({ ...draft, town: e.target.value })}
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
              value={draft.cashOfficeHours}
              onChange={(e) => setDraft({ ...draft, cashOfficeHours: e.target.value })}
            />
          </SettingsField>
          <SettingsField label={copy.profile.officeAddress} htmlFor="office-address">
            <Input
              id="office-address"
              placeholder={copy.profile.officeAddressPlaceholder}
              value={draft.cashOfficeAddress}
              onChange={(e) => setDraft({ ...draft, cashOfficeAddress: e.target.value })}
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
