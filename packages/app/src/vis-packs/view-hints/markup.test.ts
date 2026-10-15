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
      '<svg><text><title>residual of chain</title><tspan>residual</tspan>…</text></svg>',
    );
    expect(toSvgText('E_{K} (hartree)', 4)).toBe(
      '<svg><text><title>EK (hartree)</title><tspan>E</tspan><tspan baseline-shift="sub" font-size="75%">K</tspan><tspan> </tspan>…</text></svg>',
    );
    expect(toSvgText('short', 9)).toBe('<svg><text>short</text></svg>');
  });
});
