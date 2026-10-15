import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs, type VisScaleType } from '../models';
import {
  DEFAULT_MAX_VERTICES,
  getDownsamplingStride,
  getSampledIndices,
  sampleArray,
} from '../surface/utils';
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
import { SurfaceRepresentation } from './models';
import ParamSurfaceMesh from './ParamSurfaceMesh';
import {
  buildParamSurfaceBuffers,
  isParamSurfaceSupported,
  toLogicalArray,
} from './utils';

interface Props extends ClassStyleAttrs {
  x: NdArray<NumArray>; // x(u, v): 2D, same shape as `y`, `z` and `values`
  y: NdArray<NumArray>;
  z: NdArray<NumArray>;
  values: NdArray<NumArray>; // scalar field on the surface, used for colouring
  domain?: Domain; // defaults to domain of `values`
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  invertColorMap?: boolean;
  title?: ReactNode;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  shading?: boolean;
  representation?: SurfaceRepresentation;
  ignoreValue?: IgnoreValue;
  maxVertices?: number;
}

function ParamSurfaceVis(props: PropsWithChildren<Props>) {
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
    shading = true,
    representation = SurfaceRepresentation.Surface,
    ignoreValue,
    maxVertices = DEFAULT_MAX_VERTICES,
    children,
    className,
    style,
  } = props;

  if (!isParamSurfaceSupported(x, y, z, values)) {
    throw new Error(
      'Expected two-dimensional arrays of same shape, with at least two rows and two columns',
    );
  }

  const [rows, cols] = x.shape;

  // Downsample large grids
  const sampled = useMemo(() => {
    const stride = getDownsamplingStride(rows, cols, maxVertices);
    const rowIndices = getSampledIndices(rows, stride);
    const colIndices = getSampledIndices(cols, stride);
    return {
      // Colours and domains iterate `data` directly, so views must be materialised
      x: toLogicalArray(sampleArray(x, rowIndices, colIndices)),
      y: toLogicalArray(sampleArray(y, rowIndices, colIndices)),
      z: toLogicalArray(sampleArray(z, rowIndices, colIndices)),
      values: toLogicalArray(sampleArray(values, rowIndices, colIndices)),
    };
  }, [x, y, z, values, rows, cols, maxVertices]);

  const colorDomain = useMemo(
    () =>
      domain ??
      getDomain(toLogicalArray(values).data, {
        scaleType: Array.isArray(scaleType) ? scaleType[0] : scaleType,
        ignoreValue,
      }) ??
      DEFAULT_DOMAIN,
    [domain, values, scaleType, ignoreValue],
  );

  const domains = useMemo<[Domain, Domain, Domain]>(
    () => [
      getExtentDomain(sampled.x.data),
      getExtentDomain(sampled.y.data),
      getExtentDomain(sampled.z.data),
    ],
    [sampled],
  );

  const [w, h, d] = getBoxSize(domains, keepRatio);

  const buffers = useMemo(
    () =>
      buildParamSurfaceBuffers({
        ...sampled,
        toWorld: getWorldTransform(domains, [w, h, d]),
        ignoreValue,
      }),
    [sampled, domains, w, h, d, ignoreValue],
  );

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  const colors = useMemo(
    () =>
      getVertexColors(
        getColorParams(
          sampled.values.data,
          colorDomain,
          scaleType,
          ignoreValue,
        ),
        colorLut,
      ),
    [sampled, colorDomain, scaleType, ignoreValue, colorLut],
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
      <ParamSurfaceMesh
        buffers={buffers}
        rows={sampled.x.shape[0]}
        cols={sampled.x.shape[1]}
        colors={colors}
        showSurface={representation !== SurfaceRepresentation.Wireframe}
        showWireframe={representation !== SurfaceRepresentation.Surface}
        shading={shading}
        edgeColor="black"
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

export type { Props as ParamSurfaceVisProps };
export default ParamSurfaceVis;
