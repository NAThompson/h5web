import { type ArrayValue } from '@h5web/shared/hdf5-models';

import { useLineConfig } from '../core/line/config';
import MappedLineVis from '../core/line/MappedLineVis';
import { type DimScaleAxes } from '../dimscales/hooks';
import { getLineSuggestions } from '../view-hints/suggestions';
import {
  type PanelDataset,
  type PanelSpec,
  type PanelVisOptions,
} from './models';

interface Props {
  spec: PanelSpec;
  value: ArrayValue<PanelDataset['type']>;
  axes: DimScaleAxes;
  panel: PanelVisOptions;
}

function LinePanel(props: Props) {
  const { spec, value, axes, panel } = props;
  const { dataset, hint, mapping } = spec;
  const xScale = axes.axisScales[mapping.indexOf('x')];
  const config = useLineConfig({
    ...getLineSuggestions(hint),
    xScaleType: xScale?.scaleType,
  });

  return (
    <MappedLineVis
      dataset={dataset}
      value={value}
      dimMapping={mapping}
      axisLabels={axes.axisLabels}
      axisValues={axes.axisValues}
      axisTicks={axes.axisTicks}
      xSymlogConstant={xScale?.symlogConstant}
      title="" // in the panel's header
      valueLabel={hint.valueLabel}
      config={config}
      symlogThreshold={hint.symlogThreshold}
      valueTransform={hint.valueTransform}
      envelope={hint.envelope}
      dataColor={hint.curveColor}
      dataWidth={hint.curveWidth}
      nanColor={hint.nanColor}
      panel={panel}
    />
  );
}

export default LinePanel;
