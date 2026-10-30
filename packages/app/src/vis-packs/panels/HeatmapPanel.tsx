import { type ArrayValue } from '@h5web/shared/hdf5-models';
import { type Domain } from '@h5web/shared/vis-models';
import { useEffect, useState } from 'react';

import { useHeatmapConfig } from '../core/heatmap/config';
import MappedHeatmapVis from '../core/heatmap/MappedHeatmapVis';
import { guessDimScalesKeepRatio } from '../core/utils';
import { type DimScaleAxes, useCachedDimScales } from '../dimscales/hooks';
import { useContourSource } from '../view-hints/hooks';
import { type OverlayShapes } from '../view-hints/overlays';
import { getHeatmapSuggestions } from '../view-hints/suggestions';
import {
  type PanelDataset,
  type PanelSpec,
  type PanelVisOptions,
} from './models';
import { type PanelColors } from './PanelContent';

interface Props {
  spec: PanelSpec;
  value: ArrayValue<PanelDataset['type']>;
  axes: DimScaleAxes;
  colors?: PanelColors; // shared colour domain and map
  panel: PanelVisOptions;
  overlays?: OverlayShapes;
  onDataDomainChange?: (key: string, domain: Domain | undefined) => void;
}

function HeatmapPanel(props: Props) {
  const { spec, value, axes, colors, panel, overlays, onDataDomainChange } =
    props;
  const { dataset, hint, mapping, key } = spec;

  // Keep the ratio as the single view does: hinted, or when the axes share a unit
  const dimScales = useCachedDimScales(dataset);
  const [xScale, yScale] = [
    dimScales[mapping.indexOf('x')],
    dimScales[mapping.indexOf('y')],
  ];
  const [xUnit, yUnit] = [xScale?.unit, yScale?.unit];
  const isRatioMeaningless =
    (!!xUnit && !!yUnit && xUnit !== yUnit) ||
    axes.axisScales.some((scale) => !!scale?.scaleType);
  const [dataDomain, setDataDomain] = useState<Domain>();
  const config = useHeatmapConfig(
    getHeatmapSuggestions(
      isRatioMeaningless ? { ...hint, keepRatio: false } : hint,
      dataset.path,
      {
        keepRatio: guessDimScalesKeepRatio(xScale, yScale),
      },
      dataDomain,
    ),
  );
  const contourOf = useContourSource(dataset, hint, mapping);

  const [min, max] = dataDomain ?? [];
  useEffect(() => {
    onDataDomainChange?.(
      key,
      min === undefined || max === undefined ? undefined : [min, max],
    );
  }, [key, min, max, onDataDomainChange]);
  useEffect(() => () => onDataDomainChange?.(key, undefined), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MappedHeatmapVis
      dataset={dataset}
      value={value}
      dimMapping={mapping}
      axisLabels={axes.axisLabels}
      axisValues={axes.axisValues}
      axisTicks={axes.axisTicks}
      axisScales={axes.axisScales}
      title="" // in the panel's header
      valueLabel={hint.valueLabel}
      toolbarContainer={undefined}
      config={{
        ...config,
        surface: false,
        probe: false,
        ...(colors && {
          customDomain: colors.domain,
          colorMap: colors.colorMap ?? config.colorMap,
        }),
      }}
      overlays={overlays}
      symlogThreshold={hint.symlogThreshold}
      specialColors={hint}
      valueTransform={hint.valueTransform}
      onDataDomainChange={setDataDomain}
      categoryHint={hint}
      contourSource={contourOf.source}
      emphasisStyle={{
        width: hint.contourEmphasizeWidth,
        color: hint.contourEmphasizeColor,
      }}
      panel={panel}
    />
  );
}

export type { Props as HeatmapPanelProps };
export default HeatmapPanel;
