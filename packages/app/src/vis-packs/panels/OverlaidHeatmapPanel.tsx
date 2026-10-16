import { useMemo } from 'react';

import { useOverlayShapes, useResolvedOverlays } from '../view-hints/hooks';
import { buildOverlayShapes, type OverlayShapes } from '../view-hints/overlays';
import HeatmapPanel, { type HeatmapPanelProps } from './HeatmapPanel';

const COMPACT_POINT_SCALE = 0.4;

/* Small panels: lines only, small markers (texts and inline labels would cover the plot) */
function toCompactShapes(shapes: OverlayShapes): OverlayShapes {
  return {
    ...shapes,
    points: shapes.points.map((points) => ({
      ...points,
      size: Math.max(2, points.size * COMPACT_POINT_SCALE),
    })),
    texts: [],
  };
}

/* Heatmap panel with the overlays of its hint: resolved once per dataset, at the panel's index
 * along a linked dimension (no extra slider for a dimension the dataset doesn't have) */
function OverlaidHeatmapPanel(
  props: HeatmapPanelProps & { isCompact: boolean },
) {
  const { isCompact, ...panelProps } = props;
  const { spec } = panelProps;
  const { dataset, hint, mapping } = spec;

  const resolved = useResolvedOverlays(dataset, hint);
  const baseDim = resolved?.link?.baseDim;
  const index = baseDim === undefined ? undefined : mapping[baseDim];
  const x = mapping.indexOf('x');
  const y = mapping.indexOf('y');
  const axes = useMemo(() => ({ x, y }), [x, y]);
  const { shapes } = useOverlayShapes(
    resolved,
    typeof index === 'number' ? index : undefined,
    axes,
    buildOverlayShapes,
  );

  const panelShapes = useMemo(
    () => (shapes && isCompact ? toCompactShapes(shapes) : shapes),
    [shapes, isCompact],
  );

  return <HeatmapPanel {...panelProps} overlays={panelShapes} />;
}

export default OverlaidHeatmapPanel;
