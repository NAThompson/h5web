import { type DimensionMapping, type LegendEntry } from '@h5web/lib';
import { type ArrayShape, type Dataset } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useOverlayShapes, useResolvedOverlays } from './hooks';
import { renderMarkup } from './markup';
import { type ReferenceOverlay, type ViewHint } from './models';
import { isReference, type ShapeBuilder } from './overlays';

export const REFERENCE_COLOR = '#666';
const NO_SHAPES: ReferenceShape[] = [];

/* Reference line at a value (`hline`, `vline`), or shaded interval [lo, hi] (`band`) */
export interface ReferenceShape {
  kind: ReferenceOverlay['kind'];
  axis: 'x' | 'y';
  values: number[];
  color: string;
  width: number;
  dash: boolean;
  label?: string;
}

/* Shapes of the reference overlays of a line view whose values are available */
export function buildReferenceShapes(
  ...[overlays, getValues]: Parameters<ShapeBuilder<ReferenceShape[]>>
): ReferenceShape[] {
  return overlays.flatMap((overlay) => {
    const { hint, inputs } = overlay;
    const values = inputs.value && getValues(overlay, inputs.value);
    if (
      !isReference(hint) ||
      values?.length !== (hint.kind === 'band' ? 2 : 1)
    ) {
      return [];
    }
    return [
      {
        kind: hint.kind,
        axis: hint.axis,
        values,
        color: hint.color ?? REFERENCE_COLOR,
        width: hint.width ?? 1.5,
        dash: hint.dash ?? false,
        label: hint.label,
      },
    ];
  });
}

/* Reference overlays of a line hint (`hline`, `vline`, `band`) at the linked index, their legend
 * entries, and notes (overlays drawn on heatmaps are noted, not drawn) */
export function useLineOverlays(
  base: Dataset<ArrayShape>,
  hint: ViewHint,
  mapping: DimensionMapping,
): { shapes: ReferenceShape[]; legend: LegendEntry[]; notes: string[] } {
  const resolved = useResolvedOverlays(base, hint);
  const references = useMemo(
    () =>
      resolved && {
        ...resolved,
        overlays: resolved.overlays.filter(({ hint: o }) => isReference(o)),
      },
    [resolved],
  );

  const baseDim = resolved?.link?.baseDim;
  const linkedIndex = baseDim === undefined ? undefined : mapping[baseDim];
  const index = typeof linkedIndex === 'number' ? linkedIndex : undefined;
  const { shapes = NO_SHAPES, notes } = useOverlayShapes(
    references,
    index,
    { x: mapping.indexOf('x'), y: -1 },
    buildReferenceShapes,
  );

  const legend = useMemo(
    () =>
      hint.legend === false
        ? []
        : shapes.flatMap(({ kind, label, color, dash }) =>
            label
              ? [
                  {
                    label: renderMarkup(label),
                    color,
                    dash,
                    isBand: kind === 'band',
                  },
                ]
              : [],
          ),
    [shapes, hint.legend],
  );

  const others = resolved?.overlays.filter(({ hint: o }) => !isReference(o));
  return {
    shapes,
    legend,
    notes: [
      ...notes,
      ...(others ?? []).map(({ label }) => `${label}: drawn on heatmaps only`),
    ],
  };
}
