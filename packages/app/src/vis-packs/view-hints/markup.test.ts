import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderSvgMarkup } from './markup';

function toSvgText(label: string, maxChars?: number): string {
  return renderToStaticMarkup(
    createElement(
      'svg',
      null,
      createElement('text', null, renderSvgMarkup(label, maxChars)),
    ),
  );
}

describe('renderSvgMarkup', () => {
  it('should cut long labels short with an ellipsis, in full in a tooltip', () => {
    expect(toSvgText('residual of chain', 9)).toBe(
      '<svg><text><tspan data-text="residual of chain"><title>residual of chain</title><tspan>residual</tspan>…</tspan></text></svg>',
    );
    expect(toSvgText('E_{k} (hartree)', 4)).toBe(
      '<svg><text><tspan data-text="Eₖ (hartree)"><title>Eₖ (hartree)</title><tspan>E</tspan><tspan baseline-shift="sub" font-size="75%">k</tspan><tspan> </tspan>…</tspan></text></svg>',
    );
    expect(toSvgText('short', 9)).toBe('<svg><text>short</text></svg>');
  });
});
