'use client';

import { useState } from 'react';
import { ar } from '@mechanization/shared-schemas';
import { PropertyCard, type PropertyDraft } from './property-card';

/**
 * Steps 3–4 merged into one repeatable section, because a citizen may own or
 * rent several units. Completed cards collapse to a one-line summary so the
 * page never becomes a long scroll of duplicated fields.
 */
export function PropertyStep({
  tenant,
  properties,
  onChange,
  suggestedType,
}: {
  tenant: string;
  properties: PropertyDraft[];
  onChange: (next: PropertyDraft[]) => void;
  suggestedType?: 'TENT';
}) {
  const [openIndex, setOpenIndex] = useState(0);

  const update = (index: number, next: PropertyDraft) =>
    onChange(properties.map((p, i) => (i === index ? next : p)));

  const remove = (index: number) => {
    onChange(properties.filter((_, i) => i !== index));
    setOpenIndex((current) => Math.max(0, current - (index <= current ? 1 : 0)));
  };

  const add = () => {
    // Never start from an empty list: an "add" button with nothing above it
    // confuses first-time users. The first card is always present.
    onChange([...properties, { propertyType: suggestedType }]);
    setOpenIndex(properties.length);
  };

  const isComplete = (p: PropertyDraft) =>
    Boolean(p.occupancyType && p.propertyType && p.propertyNumber);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-bold">عقاراتك</h2>
        <p className="mt-1 text-muted">
          سجّل كل عقار أو وحدة تملكها أو تستأجرها. يمكنك إضافة أكثر من عقار.
        </p>
      </div>

      {properties.map((property, index) =>
        index === openIndex ? (
          <PropertyCard
            key={index}
            tenant={tenant}
            index={index}
            draft={property}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
            canRemove={properties.length > 1}
          />
        ) : (
          <button
            key={index}
            type="button"
            onClick={() => setOpenIndex(index)}
            className="flex w-full min-h-touch items-center justify-between gap-4 rounded-card border-2 border-rule bg-card px-5 py-4 text-start hover:border-cedar"
          >
            <span>
              <span className="block font-medium">العقار {index + 1}</span>
              <span className="block text-sm text-muted">
                {property.propertyType ? ar.propertyType[property.propertyType] : 'لم يُستكمل'}
                {property.propertyNumber ? ` — رقم ${property.propertyNumber}` : ''}
              </span>
            </span>
            <span
              aria-hidden
              className={isComplete(property) ? 'stamp px-2 py-1 text-sm' : 'stamp stamp--pending px-2 py-1 text-sm'}
            >
              {isComplete(property) ? 'مكتمل' : 'ناقص'}
            </span>
          </button>
        ),
      )}

      {/* Only offered once the open card has its essentials, so a citizen can't
          accumulate a stack of half-filled cards. */}
      {isComplete(properties[openIndex] ?? {}) ? (
        <button
          type="button"
          onClick={add}
          className="min-h-touch w-full rounded-card border-2 border-dashed border-cedar px-5 py-4 font-medium text-cedar hover:bg-cedar-soft"
        >
          + إضافة عقار آخر
        </button>
      ) : null}
    </div>
  );
}
