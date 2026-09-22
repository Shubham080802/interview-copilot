/**
 * What a searchable dropdown (see `src/components/Combobox.tsx`) should list: everything, grouped
 * into "popular" and the rest, while the box isn't being actively filtered — or just what matches
 * the typed text once it is.
 *
 * `filtering` is tracked separately from comparing the typed text to the field's value: a combobox
 * that reports every keystroke upward (so free text is usable without picking a suggestion) makes
 * `query === value` true again the instant the parent re-renders, which would silently drop the
 * filter after the very first character.
 */
export interface GroupedOptions {
  popular: string[];
  rest: string[];
}

export function groupOptions(options: string[], popular: string[], query: string, filtering: boolean): GroupedOptions {
  if (!filtering || query.trim() === "") {
    const popularShown = popular.filter((o) => options.includes(o));
    return { popular: popularShown, rest: options.filter((o) => !popularShown.includes(o)) };
  }
  const q = query.toLowerCase();
  return { popular: [], rest: options.filter((o) => o.toLowerCase().includes(q)) };
}
