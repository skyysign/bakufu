'use client';
import { useState } from 'react';
import { defaultConfig, type StarterPackPlan } from '@card-engine/config';
import { defaultPackName } from '@card-engine/core';
import { SettingRow, UnitInput } from './rules-fields';

export function StarterPackFields({
  options,
  value,
  onChange,
  maximum,
  onMaximumChange,
}: {
  options: { category: string; poolSize: number }[] | null;
  value: StarterPackPlan | undefined;
  onChange: (value: StarterPackPlan | undefined) => void;
  maximum: number;
  onMaximumChange: (value: number) => void;
}) {
  const [query, setQuery] = useState('');
  const matches =
    options?.filter((option) =>
      option.category.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];
  const selected = value?.categories ?? [];
  function select(category: string, present: boolean) {
    const suggested = defaultPackName(category);
    const name =
      category.toLowerCase() === 'all characters'
        ? `${category} category`
        : selected.some((pack) => pack.name === suggested)
          ? `${suggested} (${category})`
          : suggested;
    onChange({
      schemaVersion: 1,
      categories: present
        ? [
            ...selected,
            {
              category,
              name,
            },
          ]
        : selected.filter((pack) => pack.category !== category),
    });
  }
  return (
    <fieldset className="settings-group starter-pack-fields">
      <legend className="settings-group-legend">Pack generation</legend>
      <p className="setting-help settings-group-note">
        Only All Characters is required; every other pack is optional. Preview your catalog to
        choose categories (or none) and rename their packs. Changing the catalog resets this
        selection.
      </p>
      <SettingRow
        id="minimumPoolSize"
        label="Minimum characters per pack pool"
        help="A category needs at least this many characters to become a pack."
      >
        <UnitInput
          id="minimumPoolSize"
          name="minimumPoolSize"
          unit="characters"
          min={1}
          max={10000}
          defaultValue={defaultConfig.minimumPoolSize}
          aria-describedby="minimumPoolSize-help"
          required
        />
      </SettingRow>
      <SettingRow id="maximumCategoryPacks" label="Maximum category packs">
        <UnitInput
          id="maximumCategoryPacks"
          name="maximumCategoryPacks"
          unit="packs"
          min={0}
          max={30}
          value={maximum}
          onChange={(event) => onMaximumChange(Number(event.target.value))}
          required
        />
      </SettingRow>
      <SettingRow
        id="starter-pack-mode"
        label="Category pack selection"
        help="Automatic picks the largest categories. Choose myself to pick any of them, or none."
      >
        <select
          id="starter-pack-mode"
          aria-describedby="starter-pack-mode-help"
          value={value ? 'manual' : 'automatic'}
          onChange={(event) =>
            onChange(
              event.target.value === 'manual' ? { schemaVersion: 1, categories: [] } : undefined,
            )
          }
        >
          <option value="automatic">Automatic</option>
          <option value="manual" disabled={options === null}>
            Choose myself
          </option>
        </select>
      </SettingRow>
      {value && (
        <>
          <p className="small" role="status">
            {selected.length} / {maximum} category packs selected. With none selected, only All
            Characters is created.
          </p>
          <label htmlFor="pack-category-search">Search catalog categories</label>
          <input
            id="pack-category-search"
            type="search"
            value={query}
            onChange={(event) => {
              event.stopPropagation();
              setQuery(event.target.value);
            }}
          />
          <div
            className="starter-category-choices"
            role="group"
            aria-label="Choose starter pack categories"
          >
            {matches.slice(0, 50).map((option) => {
              const checked = selected.some((pack) => pack.category === option.category);
              return (
                <label className="check-label" key={option.category}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= maximum}
                    onChange={(event) => select(option.category, event.target.checked)}
                  />
                  <span>
                    {option.category} ({option.poolSize} characters)
                  </span>
                </label>
              );
            })}
            {!matches.length && <p>No matching categories. Try another search.</p>}
          </div>
          <p className="small quiet">
            Showing {Math.min(matches.length, 50)} of {matches.length} matching categories.
          </p>
          {selected.map((pack, index) => (
            <div key={pack.category} className="starter-pack-name">
              <label htmlFor={`starter-name-${index}`}>Pack name for {pack.category}</label>
              <input
                id={`starter-name-${index}`}
                value={pack.name}
                maxLength={80}
                required
                onChange={(event) => {
                  const name = event.target.value;
                  onChange({
                    schemaVersion: 1,
                    categories: selected.map((current) =>
                      current.category === pack.category ? { ...current, name } : current,
                    ),
                  });
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => select(pack.category, false)}
              >
                Remove {pack.category}
              </button>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );
}
