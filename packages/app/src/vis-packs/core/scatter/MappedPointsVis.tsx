import {
  Scatter3DVis,
  ScatterPlotVis,
  useDomain,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useVisScaleType } from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { type ViewHint } from '../../view-hints/models';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { getColorSuggestions } from '../../view-hints/suggestions';
import { getRootScaleNotes } from '../../view-hints/utils';
import { useSuggestions } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type ScatterConfig } from './config';
import PointsToolbar from './PointsToolbar';
import { type ScatterData } from './ScatterFetcher';
import { type ScatterSource } from './source';

const NO_VALUES = new Float64Array(0);

interface Props {
  source: ScatterSource;
  data: ScatterData;
  hint: ViewHint;
  is3D: boolean;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: ScatterConfig;
}

/* Values that colour the points, if any, and their label. In 2D, points without colour values
 * are coloured by their z coordinate, if any. Values at CF `coordinates` are labelled by their
 * CF `units` and `long_name`, as in other views. */
function getColorChannel(
  { channels, form }: ScatterSource,
  data: ScatterData,
  hint: ViewHint,
  is3D: boolean,
): { values?: NumArray; label?: string } {
  if (channels.color) {
    const isField = form === 'coordinates';
    return {
      values: data.color,
      label: isField
        ? (hint.valueLabel ?? channels.color.label)
        : channels.color.label,
    };
  }
  return !is3D && channels.z ? { values: data.z, label: channels.z.label } : {};
}

function MappedPointsVis(props: Props) {
  const { source, data, hint, is3D, title, toolbarContainer } = props;
  const { config: storedConfig } = props;
  const { channels } = source;

  // A file's `H5WEB_*` view hint: scale first, since the data domain depends on it
  const hinted = useSuggestions(storedConfig, {
    scaleType: hint.scaleType,
    invertColorMap: hint.invertColorMap,
    keepRatio: hint.keepRatio,
    opacity: source.opacity,
  });
  const { scaleType } = hinted;

  const { values: colorValues, label: colorBarLabel } = getColorChannel(
    source,
    data,
    hint,
    is3D,
  );

  const dataDomain =
    useDomain(colorValues ?? NO_VALUES, { scaleType }) || DEFAULT_DOMAIN;
  const config = useSuggestions(hinted, getColorSuggestions(hint, dataDomain));
  const { customDomain, colorMap, invertColorMap, showGrid, sizeScale } =
    config;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);
  const visScaleType = useVisScaleType(scaleType, hint.symlogThreshold);

  const common = {
    className: visualizerStyles.vis,
    x: data.x,
    y: data.y,
    values: colorValues,
    domain: safeDomain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap,
    color: source.solidColor,
    nanColor: hint.nanColor,
    belowColor: hint.belowColor,
    aboveColor: hint.aboveColor,
    sizes: data.size,
    sizeRange: source.sizeRange,
    pointSize: source.pointSize,
    sizeScale,
    opacity: config.opacity,
    xLabel: channels.x.label,
    yLabel: channels.y.label,
    colorBarLabel,
    sizeLabel: channels.size?.label,
    showGrid,
    title: renderMarkup(title),
  };

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <PointsToolbar
            dataDomain={colorValues && dataDomain}
            config={config}
            is3D={is3D}
          />,
          toolbarContainer,
        )}

      {is3D && data.z ? (
        <Scatter3DVis
          {...common}
          z={data.z}
          zLabel={channels.z?.label}
          keepRatio={config.keepRatio}
          showAxes={config.showAxes}
        />
      ) : (
        <ScatterPlotVis
          {...common}
          xScaleType={config.xScaleType}
          yScaleType={config.yScaleType}
          extraChannels={
            channels.z && data.z && colorValues !== data.z
              ? [{ label: channels.z.label, values: data.z }]
              : undefined
          }
        />
      )}
      <OverlayNotes
        notes={[...hint.notes, ...getRootScaleNotes(hint), ...source.notes]}
      />
    </>
  );
}

export default MappedPointsVis;
