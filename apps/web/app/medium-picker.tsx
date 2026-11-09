'use client';
import {
  aniListMedia,
  aniListMediumInfo,
  jikanMedia,
  jikanMediumInfo,
  type AniListMedium,
  type JikanMedium,
} from '../../../packages/importers/src/media';

export const malMediumOptions = jikanMedia.map((value) => ({
  value,
  label: jikanMediumInfo[value].label,
}));
export const aniListMediumOptions = aniListMedia.map((value) => ({
  value,
  label: aniListMediumInfo[value].label,
}));
export type ProviderMedium = JikanMedium | AniListMedium;
export const mediumLabel = (value: string) =>
  (value in jikanMediumInfo
    ? jikanMediumInfo[value as JikanMedium].label
    : aniListMediumInfo[value as AniListMedium]?.label) ?? value;

/**
 * Checkbox group for the kinds of series a roster walks (anime, manhwa,
 * donghua, …). At least one stays selected.
 */
export function MediumPicker<T extends string>({
  legend,
  options,
  value,
  onChange,
  disabled,
  name,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <fieldset className="medium-picker" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="medium-options">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label key={option.value} className="check-label">
              <input
                type="checkbox"
                name={name}
                checked={checked}
                // The last selected kind can't be cleared.
                disabled={checked && value.length === 1}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? options
                          .map((item) => item.value)
                          .filter((item) => item === option.value || value.includes(item))
                      : value.filter((item) => item !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
