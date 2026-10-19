import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs } from '../models';
import ParamSurfaceMesh from '../param-surface/ParamSurfaceMesh';
import { buildParamSurfaceBuffers } from '../param-surface/utils';
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
import { useGpuDevice } from './hooks';
import {
  getKnotSpans,
  getKnotVectors,
  getSurfaceSampleCounts,
  type KnotSpan,
  type NurbsSurface,
  sampleNurbsSurface,
} from './nurbs';
import NurbsControlNet from './NurbsControlNet';
import NurbsDepthMesh from './NurbsDepthMesh';
import NurbsGpuSurface from './NurbsGpuSurface';
import NurbsKnotLines from './NurbsKnotLines';
import { MAX_GPU_DEGREE } from './webgpu';

/* Without WebGPU, the surface is sampled once, as if the box were this many pixels wide; this
 * also gives the extent of the surface, and the copy hiding WebGL content behind it */
const NOMINAL_PIXELS = 1000;
const CONTROL_NET_COLOR = '#d6266e';

interface Props extends ClassStyleAttrs {
  surface: NurbsSurface; // valid (cf. `getNurbsSurfaceError`)
  title?: ReactNode;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string; // also of the colour bar
  colorMap?: ColorMap; // by height
  invertColorMap?: boolean;
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  showControlNet?: boolean; // dashed, with markers at the control points
  showKnotLines?: boolean; // iso-parameter lines at the knots
}

/*
 * NURBS surface in a 3D box with orbit controls, evaluated with WebGPU (compute shader, finer as
 * the camera gets closer) if available, else on the CPU and drawn with WebGL.
 */
function NurbsSurfaceVis(props: PropsWithChildren<Props>) {
  const {
    surface,
    title,
    xLabel = 'x',
    yLabel = 'y',
    zLabel = 'z',
    colorMap = 'Viridis',
    invertColorMap = false,
    keepRatio = true,
    showAxes = true,
    showGrid = true,
    showControlNet = false,
    showKnotLines = false,
    children,
    className,
    style,
  } = props;

  const device = useGpuDevice(Math.max(...surface.degrees) <= MAX_GPU_DEGREE);
  const spans = useMemo(
    () =>
      getKnotVectors(surface).map((vec) => getKnotSpans(vec)) as [
        KnotSpan[],
        KnotSpan[],
      ],
    [surface],
  );

  const { counts, rows, cols, coords, controlCoords } = useMemo(() => {
    const { points } = surface;
    const control = [0, 1, 2].map((d) => points.filter((_, i) => i % 3 === d));
    const longest = Math.max(
      ...control.map((arr) => {
        const [min, max] = getExtentDomain(arr);
        return max - min;
      }),
    );
    const scale = NOMINAL_PIXELS / (longest || 1);
    const sampleCounts = getSurfaceSampleCounts(
      surface,
      spans,
      Float64Array.from(points, (val) => val * scale),
    );
    const samples = sampleNurbsSurface(surface, spans, sampleCounts);
    return {
      counts: sampleCounts,
      rows: sampleCounts[0].reduce((acc, n) => acc + n, 1),
      cols: sampleCounts[1].reduce((acc, n) => acc + n, 1),
      coords: [0, 1, 2].map((d) => samples.filter((_, i) => i % 3 === d)),
      controlCoords: control,
    };
  }, [surface, spans]);

  // Box around surface and control points; colours by height of the surface
  const domains = useMemo(
    () =>
      [0, 1, 2].map((d) => getExtentDomain(coords[d], controlCoords[d])) as [
        Domain,
        Domain,
        Domain,
      ],
    [coords, controlCoords],
  );
  const zDomain = useMemo(() => getExtentDomain(coords[2]), [coords]);
  const [w, h, d] = getBoxSize(domains, keepRatio);

  const { toWorld, worldSurface, zRange } = useMemo(() => {
    const transform = getWorldTransform(domains, [w, h, d]);
    const { points } = surface;
    const worldPoints = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 3) {
      worldPoints.set(transform(points[i], points[i + 1], points[i + 2]), i);
    }
    const range: [number, number] = [
      transform(0, 0, zDomain[0])[2],
      transform(0, 0, zDomain[1])[2],
    ];
    return {
      toWorld: transform,
      worldSurface: { ...surface, points: worldPoints },
      zRange: range,
    };
  }, [surface, domains, zDomain, w, h, d]);

  const buffers = useMemo(() => {
    const [x, y, z] = coords.map((arr) => ndarray(arr, [rows, cols]));
    return buildParamSurfaceBuffers({ x, y, z, values: z, toWorld });
  }, [coords, rows, cols, toWorld]);

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );
  const colors = useMemo(
    () =>
      getVertexColors(
        getColorParams(coords[2], zDomain, ScaleType.Linear),
        colorLut,
      ),
    [coords, zDomain, colorLut],
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
      domain={zDomain}
      scaleType={ScaleType.Linear}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel={zLabel}
      renderer={device === undefined ? undefined : device ? 'webgpu' : 'webgl'}
      headlight
    >
      {device && (
        <>
          <NurbsGpuSurface
            device={device}
            surface={worldSurface}
            spans={spans}
            colorLut={colorLut}
            zRange={zRange}
            showKnotLines={showKnotLines}
          />
          <NurbsDepthMesh positions={buffers.positions} index={buffers.index} />
        </>
      )}
      {device === null && (
        <>
          <ParamSurfaceMesh
            buffers={buffers}
            rows={rows}
            cols={cols}
            colors={colors}
            showSurface
            showWireframe={false}
            shading
            edgeColor="black"
          />
          {showKnotLines && (
            <NurbsKnotLines positions={buffers.positions} counts={counts} />
          )}
        </>
      )}
      {showControlNet && (
        <NurbsControlNet surface={worldSurface} color={CONTROL_NET_COLOR} />
      )}
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

export type { Props as NurbsSurfaceVisProps };
export default NurbsSurfaceVis;
