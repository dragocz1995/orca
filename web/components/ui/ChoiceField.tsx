'use client';
import { useMemo, useState } from 'react';
import { ManageSelectionModal, type ManageSelectionItem } from './ManageSelectionModal';
import { Segmented } from './Segmented';
import { SelectionSummary } from './SelectionSummary';
import { useTranslation } from '../../lib/i18n';

/** Canonical single-choice field: two or three choices stay inline; larger catalogs use the shared
 *  searchable picker. Unknown persisted values remain selectable so opening the UI never drops data.
 *  `picker="always"` skips the inline form even for short lists (constellation pods pick in the
 *  drawer regardless of count). */
export function ChoiceField({ title, options, value, onChange, picker = 'auto' }: {
  title: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  picker?: 'auto' | 'always';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = useMemo<ManageSelectionItem[]>(() => {
    const known = new Set(options.map((option) => option.value));
    return [
      ...(value && !known.has(value) ? [{ id: value, label: value, group: '' }] : []),
      ...options.map((option) => ({ id: option.value, label: option.label, group: '' })),
    ];
  }, [options, value]);
  if (picker === 'auto' && items.length <= 3) {
    return (
      <Segmented
        aria-label={title}
        size="sm"
        options={items.map((item) => ({ value: item.id, label: item.label }))}
        value={value}
        onChange={onChange}
      />
    );
  }
  const selected = items.find((item) => item.id === value);
  return (
    <>
      <SelectionSummary
        countText=""
        samples={selected ? [{ label: selected.label }] : []}
        moreCount={0}
        onManage={() => setOpen(true)}
        manageLabel={t.managePicker.manage}
      />
      <ManageSelectionModal
        title={title}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selected={new Set(value ? [value] : [])}
        single
        onSave={(next) => onChange([...next][0] ?? '')}
      />
    </>
  );
}
