import { ColorBar } from '@h5web/lib';

import { useHeatmapConfig } from '../core/heatmap/config';
import { renderMarkup } from '../view-hints/markup';
import { getHeatmapSuggestions } from '../view-hints/suggestions';
import { type PanelSpec } from './models';
import { type PanelColors } from './PanelContent';
import { getPanelScaleType } from './utils';

interface Props {
  spec: PanelSpec; // one of the panels sharing the colours, whose hint labels them
  colors: PanelColors;
}

/* Colour bar of panels sharing their colour domain */
function SharedColorBar(props: Props) {
  const { spec, colors } = props;
  const { hint, dataset } = spec;
  const config = useHeatmapConfig(getHeatmapSuggestions(hint, dataset.path));
  const scaleType = getPanelScaleType(hint, config); // as the panels draw it

  return (
    <ColorBar
      domain={colors.domain}
      scaleType={scaleType}
      colorMap={colors.colorMap ?? config.colorMap}
      invertColorMap={config.invertColorMap}
      withBounds
      label={renderMarkup(hint.valueLabel)}
      belowColor={hint.belowColor}
      aboveColor={hint.aboveColor}
      valueTransform={hint.valueTransform}
    />
  );
}

export default SharedColorBar;
