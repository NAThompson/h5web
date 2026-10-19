import {
  type ColorMap,
  type Domain,
  getCurl2D,
  getDivergence,
  getDomain,
  getMagnitude,
  useSafeDomain,
  useVisDomain,
  VectorBackground,
  type VectorField2D,
  type VectorField3D,
  VectorStyle,
  VectorVis,
  VectorVis3D,
} from '@h5web/lib';
import { type NumArray, ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { useStableDomain } from '../playback-range';
import { renderMarkup } from '../view-hints/markup';
import { type VectorConfig } from './config';
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
}

const DIVERGING: ColorMap = 'RdBu';

function is3DField(
  field: VectorField2D | VectorField3D,
): field is VectorField3D {
  return 'w' in field;
}

function getSymmetric(domain: Domain | undefined): Domain | undefined {
  if (!domain) {
    return undefined;
  }
  const max = Math.max(Math.abs(domain[0]), Math.abs(domain[1])) || 1;
  return [-max, max];
}

/* Scalar under the field and the label of its colour bar */
function useBackground(
  field: VectorField2D | VectorField3D,
  kind: VectorBackground,
  dataset: NumArray | undefined,
): NumArray | undefined {
  return useMemo(() => {
    const { u, v } = field;
    if (is3DField(field)) {
      return getMagnitude(u, v, field.w); // colours the arrows
    }
    switch (kind) {
      case VectorBackground.None:
      case VectorBackground.Magnitude:
        return getMagnitude(u, v); // none: still colours the arrows
      case VectorBackground.Divergence:
        return getDivergence(field);
      case VectorBackground.Curl:
        return getCurl2D(field);
      case VectorBackground.Dataset:
        return dataset;
      default:
        return undefined;
    }
  }, [field, kind, dataset]);
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
  } = props;

  const is3D = is3DField(field);
  const kind = is3D ? VectorBackground.Magnitude : config.background;
  const isSigned =
    kind === VectorBackground.Divergence || kind === VectorBackground.Curl;
  const scaleType = is3D ? ScaleType.Linear : config.scaleType; // 3D: linear colours
  const values = useBackground(field, kind, datasetBackground);

  const frameDomain = useMemo(() => {
    const domain = values && getDomain(values, { scaleType });
    return isSigned ? getSymmetric(domain) : domain;
  }, [values, scaleType, isSigned]);
  const dataDomain = useStableDomain(
    frameDomain,
    `vector-${kind}-${scaleType}`,
    () => undefined, // ranges seen so far while playing
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

  const plane =
    is3D && config.plane
      ? {
          axis: config.plane,
          index: Math.min(
            config.planeIndex,
            { x: field.xs, y: field.ys, z: field.zs }[config.plane].length - 1,
          ),
        }
      : undefined;

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
            planeSize={
              is3D && config.plane
                ? { x: field.xs, y: field.ys, z: field.zs }[config.plane].length
                : 1
            }
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
