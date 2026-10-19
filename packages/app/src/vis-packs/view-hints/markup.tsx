import { type ReactNode } from 'react';

import { toUnicodeScripts } from './attrs';
import { formatLabel } from './utils';

/* Label with `_{...}` and `^{...}` as `<sub>` and `<sup>` (the label itself if it has none), in a
 * single element so that spaces around them are kept (e.g. in flex containers); its plain-text
 * form (cf. `getTextContent`, e.g. for `aria-label`) has Unicode scripts instead */
export function renderMarkup(label: string | undefined): ReactNode {
  const parts = formatLabel(label ?? '');
  if (parts.every(({ shift }) => !shift)) {
    return label;
  }

  return (
    <span data-text={toUnicodeScripts(label)}>
      {parts.map(({ str, shift }, k) =>
        shift === 'sub' ? (
          // eslint-disable-next-line react/no-array-index-key
          <sub key={k}>{str}</sub>
        ) : shift === 'super' ? (
          // eslint-disable-next-line react/no-array-index-key
          <sup key={k}>{str}</sup>
        ) : (
          str
        ),
      )}
    </span>
  );
}

function toCodePoints(str: string): string[] {
  return str.match(/./gsu) ?? [];
}

/* Same, as SVG text content (shifted `<tspan>`), cut short with an ellipsis beyond `maxChars`
 * characters (then in full in a tooltip); code points, so as not to split surrogate pairs */
export function renderSvgMarkup(
  label: string | undefined,
  maxChars = Infinity,
): ReactNode {
  const parts = formatLabel(label ?? '');
  const text = parts.map(({ str }) => str).join('');
  const isCut = toCodePoints(text).length > maxChars;
  if (!isCut && parts.every(({ shift }) => !shift)) {
    return label;
  }

  let budget = Math.max(maxChars - 1, 1); // room for the ellipsis
  const kept = isCut
    ? parts.flatMap((part) => {
        const chars = toCodePoints(part.str).slice(0, Math.max(budget, 0));
        const str = chars.join('');
        budget -= chars.length;
        return str ? [{ ...part, str }] : [];
      })
    : parts;

  return (
    <tspan data-text={toUnicodeScripts(label)}>
      {isCut && <title>{toUnicodeScripts(label)}</title>}
      {kept.map(({ str, shift }, k) => (
        <tspan
          // eslint-disable-next-line react/no-array-index-key
          key={k}
          baselineShift={shift}
          fontSize={shift ? '75%' : undefined}
        >
          {str}
        </tspan>
      ))}
      {isCut && '…'}
    </tspan>
  );
}
