import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type PropsWithChildren, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import { CurveType } from '../line/models';
import { type ClassStyleAttrs, type VisScaleType } from '../models';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import {
  getBoxSize,
  getColorParams,
  getExtentDomain,
  getLinearColorLut,
  getVertexColors,
  getWorldTransform,
} from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import { DEFAULT_DOMAIN, getDomain } from '../utils';
import CurveMesh from './CurveMesh';
import { buildCurveBuffers, getPointIndices } from './utils';

interface Props extends ClassStyleAttrs {
  x: NumArray;
  y: NumArray;
  z?: NumArray; // curve lies in the `z = 0` plane if not provided
  values?: NumArray; // scalar field along the curve, used for colouring; defaults to point indices
  domain?: Domain; // defaults to domain of `values`
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  invertColorMap?: boolean;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  curveType?: CurveType;
  lineWidth?: number;
  pointSize?: number;
  ignoreValue?: IgnoreValue;
  /* Domains to include in the axes along x, y and z, on top of the extent of the curve
   * (e.g. to keep axes still while playing through slices) */
  axisDomains?: [Domain?, Domain?, Domain?];
}

function Curve3DVis(props: PropsWithChildren<Props>) {
  const {
    x,
    y,
    z,
    values,
    domain,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    title,
    xLabel,
    yLabel,
    zLabel = 'z',
    keepRatio = true,
    showAxes = true,
    showGrid = true,
    curveType = CurveType.LineOnly,
    lineWidth = 2,
    pointSize = 6,
    ignoreValue,
    axisDomains = [],
    children,
    className,
    style,
  } = props;

  const count = Math.min(x.length, y.length, z?.length ?? Infinity);
  const field = useMemo(
    () => values ?? getPointIndices(count),
    [values, count],
  );

  const colorDomain = useMemo(
    () =>
      domain ??
      getDomain(field, {
        scaleType: Array.isArray(scaleType) ? scaleType[0] : scaleType,
        ignoreValue,
      }) ??
      DEFAULT_DOMAIN,
    [domain, field, scaleType, ignoreValue],
  );

  const [xAxisDomain, yAxisDomain, zAxisDomain] = axisDomains;
  const domains = useMemo<[Domain, Domain, Domain]>(
    () => [
      getExtentDomain(x, xAxisDomain ?? []),
      getExtentDomain(y, yAxisDomain ?? []),
      getExtentDomain(z ?? [0], zAxisDomain ?? []),
    ],
    [x, y, z, xAxisDomain, yAxisDomain, zAxisDomain],
  );

  const [w, h, d] = getBoxSize(domains, keepRatio);

  // Missing values of the field (`NaN`, ignored values) leave gaps, as missing coordinates do
  const buffers = useMemo(
    () =>
      buildCurveBuffers(
        x,
        y,
        z,
        getWorldTransform(domains, [w, h, d]),
        (i) => Number.isFinite(field[i]) && !ignoreValue?.(field[i]),
      ),
    [x, y, z, field, ignoreValue, domains, w, h, d],
  );

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  const colors = useMemo(
    () =>
      getVertexColors(
        getColorParams(field, colorDomain, scaleType, ignoreValue),
        colorLut,
      ),
    [field, colorDomain, scaleType, ignoreValue, colorLut],
  );

  const [xConfig, yConfig, zConfig] = useMemo<Axis3DConfig[]>(
    () => [
      { domain: domains[0], label: xLabel },
      { domain: domains[1], label: yLabel },
      { domain: domains[2], label: zLabel },
    ],
    [domains, xLabel, yLabel, zLabel],
  );

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={[w, h, d]}
      domain={colorDomain}
      scaleType={scaleType}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      headlight
    >
      <CurveMesh
        buffers={buffers}
        colors={colors}
        showLine={curveType !== CurveType.GlyphsOnly}
        lineWidth={lineWidth}
        showPoints={curveType !== CurveType.LineOnly}
        pointSize={pointSize}
      />
      {showAxes && (
        <Axes3D
          boxSize={[w, h, d]}
          xConfig={xConfig}
          yConfig={yConfig}
          zConfig={zConfig}
          showGrid={showGrid}
        />
      )}
      {children}
    </Vis3DLayout>
  );
}

export type { Props as Curve3DVisProps };
export default Curve3DVis;
