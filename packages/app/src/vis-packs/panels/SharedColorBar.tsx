import { CategoryLegend, ColorBar } from '@h5web/lib';
import { useMemo } from 'react';

import { canBeCategorical, getSharedCategories } from '../core/categorical';
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

  // Categorical panels: categories of the shared domain, colored as the panels color them
  const [min, max] = colors.domain;
  const isCategorical = config.categorical && canBeCategorical(dataset, hint);
  const categories = useMemo(
    () =>
      isCategorical
        ? getSharedCategories(
            [min, max],
            config.categoricalPalette,
            hint.categoryList,
          )
        : undefined,
    [isCategorical, min, max, config.categoricalPalette, hint.categoryList],
  );

  if (isCategorical) {
    // Without categories (e.g. sparse labels over a wide domain): no legend rather than a wrong one
    return (
      categories && (
        <CategoryLegend
          categories={categories}
          label={renderMarkup(hint.valueLabel)}
        />
      )
    );
  }

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
