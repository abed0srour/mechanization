-- Several citizens may register the same رقم العقار.
--
-- A parcel is not a household. An apartment building sits on one cadastral
-- number, and every owner and tenant inside it will enter that same number —
-- which the unique index rejected, telling the second person onwards that their
-- own address was "already registered" and leaving them unable to file at all.
--
-- Co-registration is therefore the normal case, not an anomaly to be prevented.
-- What the municipality needs is to *see* everyone attached to a parcel, which
-- the staff map and its drawer now do; blocking the write only ever hid that.
--
-- The plain index replacing it keeps the lookup this column exists for — "who is
-- registered on parcel 1553" — an index scan rather than a table scan.

DROP INDEX IF EXISTS "property_entries_propertyNumber_key";

CREATE INDEX "property_entries_propertyNumber_idx"
    ON "property_entries"("propertyNumber");
