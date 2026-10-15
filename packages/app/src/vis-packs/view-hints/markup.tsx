import { type ReactNode } from 'react';

import { formatLabel } from './utils';

/* Label with `_{...}` and `^{...}` as `<sub>` and `<sup>` (the label itself if it has none), in a
 * single element so that spaces around them are kept (e.g. in flex containers) */
export function renderMarkup(label: string | undefined): ReactNode {
  const parts = formatLabel(label ?? '');
  if (parts.every(({ shift }) => !shift)) {
    return label;
  }

  return (
    <span>
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

/* Same, as SVG text content (shifted `<tspan>`) */
export function renderSvgMarkup(label: string | undefined): ReactNode {
  const parts = formatLabel(label ?? '');
  if (parts.every(({ shift }) => !shift)) {
    return label;
  }

  return parts.map(({ str, shift }, k) => (
    <tspan
      // eslint-disable-next-line react/no-array-index-key
      key={k}
      baselineShift={shift}
      fontSize={shift ? '75%' : undefined}
    >
      {str}
    </tspan>
  ));
}
