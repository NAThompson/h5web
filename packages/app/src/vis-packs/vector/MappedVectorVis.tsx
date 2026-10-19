import {
  type ColorMap,
  type Domain,
  getDomain,
  useSafeDomain,
  useVisDomain,
  VectorBackground,
  type VectorField2D,
  type VectorField3D,
  VectorStyle,
  VectorVis,
  VectorVis3D,
} from '@h5web/lib';
import {
  COLOR_SCALE_TYPES,
  type ColorScaleType,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { useStableDomain } from '../playback-range';
import { renderMarkup } from '../view-hints/markup';
import { type VectorConfig } from './config';
import { getSequenceDomain, getVectorBackground, is3DField } from './utils';
import VectorToolbar from './VectorToolbar';

interface Props {
  field: VectorField2D | VectorField3D;
  background?: NumArray; // `H5WEB_vector_background` dataset, on the field's grid
  backgroundName?: string;
  title: string;
  units?: string; // CF `units` of the field
  labels: [string?, string?, string?]; // x, y, z axes
  config: VectorConfig;
  toolbarContainer: HTMLDivElement | undefined;
  isDatasetForm: boolean; // sequences of slices (playback range) hold all components
}

const DIVERGING: ColorMap = 'RdBu';

// Signed backgrounds: no scale undefined for negative values
const SIGNED_SCALE_TYPES: ColorScaleType[] = COLOR_SCALE_TYPES.filter(
  (type) => type !== ScaleType.Log && type !== ScaleType.Sqrt,
);

function getSymmetric(domain: Domain | undefined): Domain | undefined {
  if (!domain) {
    return undefined;
  }
  const max = Math.max(Math.abs(domain[0]), Math.abs(domain[1])) || 1;
  return [-max, max];
}

function getBackgroundLabel(
  kind: VectorBackground,
  units: string | undefined,
  backgroundName: string | undefined,
): string {
  switch (kind) {
    case VectorBackground.Divergence:
      return '∇·v';
    case VectorBackground.Curl:
      return 'ω = ∂v/∂x − ∂u/∂y';
    case VectorBackground.Dataset:
      return backgroundName ?? 'background';
    default:
      return units ? `|v| (${units})` : '|v|';
  }
}

function MappedVectorVis(props: Props) {
  const {
    field,
    background: datasetBackground,
    backgroundName,
    title,
    units,
    labels,
    config,
    toolbarContainer,
    isDatasetForm,
  } = props;

  const is3D = is3DField(field);
  const kind = is3D ? VectorBackground.Magnitude : config.background;
  const isSigned =
    kind === VectorBackground.Divergence || kind === VectorBackground.Curl;
  const scaleType =
    is3D || (isSigned && !SIGNED_SCALE_TYPES.includes(config.scaleType))
      ? ScaleType.Linear // 3D: linear colours
      : config.scaleType;
  const values = useMemo(
    () => getVectorBackground(field, kind, datasetBackground),
    [field, kind, datasetBackground],
  );

  const frameDomain = useMemo(() => {
    const domain = values && getDomain(values, { scaleType });
    return isSigned ? getSymmetric(domain) : domain;
  }, [values, scaleType, isSigned]);
  const dataDomain = useStableDomain(
    frameDomain,
    `vector-${kind}-${scaleType}`,
    (sequence) => {
      // Only the first component is fetched for groups: ranges seen so far while playing
      const domain = isDatasetForm
        ? getSequenceDomain(
            sequence as ArrayLike<number>,
            field,
            kind,
            scaleType,
          )
        : undefined;
      return isSigned ? getSymmetric(domain) : domain;
    },
  ) ?? [0, 1];
  const visDomain = useVisDomain(config.customDomain, dataDomain);
  const [domain] = useSafeDomain(visDomain, dataDomain, scaleType);

  // Diverging map for signed derivatives, blue for negative values
  const colorMap = config.colorMap ?? (isSigned ? DIVERGING : 'Viridis');
  const invertColorMap =
    config.invertColorMap ?? (config.colorMap === undefined && isSigned);

  const label = getBackgroundLabel(kind, units, backgroundName);
  const backgrounds = [
    VectorBackground.Magnitude,
    VectorBackground.None,
    VectorBackground.Divergence,
    VectorBackground.Curl,
    ...(datasetBackground ? [VectorBackground.Dataset] : []),
  ];

  const shape = [field.ys.length, field.xs.length];
  const backgroundArray = useMemo(
    () =>
      values && kind !== VectorBackground.None
        ? ndarray(values, shape)
        : undefined,
    [values, kind, shape[0], shape[1]], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const planeSize =
    is3D && config.plane
      ? { x: field.xs, y: field.ys, z: field.zs }[config.plane].length
      : 1;
  const plane = useMemo(
    () =>
      is3D && config.plane
        ? {
            axis: config.plane,
            index: Math.min(config.planeIndex, planeSize - 1),
          }
        : undefined,
    [is3D, config.plane, config.planeIndex, planeSize],
  );

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <VectorToolbar
            config={config}
            dataDomain={dataDomain}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            is3D={is3D}
            backgrounds={backgrounds}
            datasetLabel={backgroundName}
            planeSize={planeSize}
            scaleType={scaleType}
            scaleTypes={isSigned ? SIGNED_SCALE_TYPES : COLOR_SCALE_TYPES}
          />,
          toolbarContainer,
        )}

      {is3D ? (
        <VectorVis3D
          className={visualizerStyles.vis}
          field={field}
          domain={domain}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
          colorBarLabel={renderMarkup(label)}
          title={renderMarkup(title)}
          labels={labels}
          keepRatio={config.keepRatio ?? true}
          showAxes={config.showAxes}
          showGrid={config.showGrid}
          vectorStyle={
            config.style === VectorStyle.Streamlines
              ? VectorStyle.Streamlines
              : VectorStyle.Arrows
          }
          arrowScale={config.arrowScale}
          plane={plane}
        />
      ) : (
        <VectorVis
          className={visualizerStyles.vis}
          field={field}
          background={backgroundArray}
          backgroundLabel={label}
          domain={domain}
          colorMap={colorMap}
          scaleType={scaleType}
          invertColorMap={invertColorMap}
          colorBarLabel={renderMarkup(label)}
          title={renderMarkup(title)}
          vectorStyle={config.style}
          arrowDensity={config.arrowDensity}
          arrowScale={config.arrowScale}
          uniformArrows={config.uniformArrows}
          abscissaParams={{ label: labels[0] }}
          ordinateParams={{ label: labels[1] }}
          aspect={(config.keepRatio ?? true) ? 'equal' : 'auto'}
          showGrid={config.showGrid}
        />
      )}
    </>
  );
}

export default MappedVectorVis;
