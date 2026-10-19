import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs } from '../models';
import { buildParamSurfaceBuffers } from '../param-surface/utils';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import {
  getBoxSize,
  getExtentDomain,
  getLinearColorLut,
  getWorldTransform,
} from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import { NurbsColorBy } from './analysis';
import { useColorDomain, useGpuDevice } from './hooks';
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
import { getSurfaceTransform } from './utils';

/* Patches are also sampled once on the CPU, as if the box were this many pixels wide, for its
 * extent (axes, colour domain) and the depth-only copy hiding WebGL content behind it */
const NOMINAL_PIXELS = 1000;
const CONTROL_NET_COLOR = '#d6266e';

interface Props extends ClassStyleAttrs {
  surfaces: NurbsSurface[]; // patches, valid (cf. `getNurbsSurfaceError`)
  title?: ReactNode;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string; // also of the colour bar, by default
  colorBarLabel?: ReactNode;
  colorBy?: NurbsColorBy;
  colorField?: number; // index in `fields` of the patches, to colour by a field or its gradient
  domain?: Domain; // of the colour map; default: domain of the values (cf. `getColorByDomain`)
  onDataDomainChange?: (domain: Domain) => void;
  colorMap?: ColorMap;
  invertColorMap?: boolean;
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  showControlNet?: boolean; // dashed, with markers at the control points
  showKnotLines?: boolean; // iso-parameter lines at the knots
}

/*
 * NURBS surface (one or more patches) in a 3D box with orbit controls, evaluated and drawn with WebGPU (compute shader,
 * finer as the camera gets closer). Throws without WebGPU (cf. `useGpuDevice`).
 */
function NurbsSurfaceVis(props: PropsWithChildren<Props>) {
  const {
    surfaces,
    title,
    xLabel = 'x',
    yLabel = 'y',
    zLabel = 'z',
    colorBarLabel = zLabel,
    colorBy = NurbsColorBy.Height,
    colorField = 0,
    domain,
    onDataDomainChange,
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

  const device = useGpuDevice(
    Math.max(...surfaces.flatMap(({ degrees }) => degrees)),
  );
  const spans = useMemo(
    () =>
      surfaces.map(
        (surface) =>
          getKnotVectors(surface).map((vec) => getKnotSpans(vec)) as [
            KnotSpan[],
            KnotSpan[],
          ],
      ),
    [surfaces],
  );

  // Patches sampled at the same scale, from the extent of all control points
  const { grids, controlCoords } = useMemo(() => {
    const points = surfaces.flatMap((surface) => [...surface.points]);
    const control = [0, 1, 2].map((d) => points.filter((_, i) => i % 3 === d));
    const longest = Math.max(
      ...control.map((arr) => {
        const [min, max] = getExtentDomain(arr);
        return max - min;
      }),
    );
    const scale = NOMINAL_PIXELS / (longest || 1);
    return {
      grids: surfaces.map((surface, p) => {
        const sampleCounts = getSurfaceSampleCounts(
          surface,
          spans[p],
          Float64Array.from(surface.points, (val) => val * scale),
        );
        const samples = sampleNurbsSurface(surface, spans[p], sampleCounts);
        return {
          sampleCounts,
          rows: sampleCounts[0].reduce((acc, n) => acc + n, 1),
          cols: sampleCounts[1].reduce((acc, n) => acc + n, 1),
          coords: [0, 1, 2].map((d) => samples.filter((_, i) => i % 3 === d)),
        };
      }),
      controlCoords: control,
    };
  }, [surfaces, spans]);

  // Box around patches and control points; colours by height of the patches
  const domains = useMemo(
    () =>
      [0, 1, 2].map((d) =>
        getExtentDomain(
          ...grids.map(({ coords }) => coords[d]),
          controlCoords[d],
        ),
      ) as [Domain, Domain, Domain],
    [grids, controlCoords],
  );
  const zDomain = useMemo(
    () => getExtentDomain(...grids.map(({ coords }) => coords[2])),
    [grids],
  );
  const [w, h, d] = getBoxSize(domains, keepRatio);

  const { toWorld, worldSurfaces, transform } = useMemo(() => {
    const toWorldCoords = getWorldTransform(domains, [w, h, d]);
    return {
      toWorld: toWorldCoords,
      worldSurfaces: surfaces.map((surface) => {
        const { points } = surface;
        const worldPoints = new Float64Array(points.length);
        for (let i = 0; i < points.length; i += 3) {
          worldPoints.set(
            toWorldCoords(points[i], points[i + 1], points[i + 2]),
            i,
          );
        }
        return { ...surface, points: worldPoints };
      }),
      transform: getSurfaceTransform(domains, toWorldCoords),
    };
  }, [surfaces, domains, w, h, d]);

  const readCounts = useMemo(
    () => grids.map(({ sampleCounts }) => sampleCounts),
    [grids],
  );
  const { dataDomain, handleValues } = useColorDomain(
    colorBy,
    colorField,
    zDomain,
    onDataDomainChange,
  );
  const colorDomain = domain ?? dataDomain;

  const buffers = useMemo(
    () =>
      grids.map(({ rows, cols, coords }) => {
        const [x, y, z] = coords.map((arr) => ndarray(arr, [rows, cols]));
        return buildParamSurfaceBuffers({ x, y, z, values: z, toWorld });
      }),
    [grids, toWorld],
  );

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
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
      scaleType={ScaleType.Linear}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel={colorBarLabel}
      renderer={device && 'webgpu'}
    >
      {device && (
        <>
          <NurbsGpuSurface
            device={device}
            surfaces={surfaces}
            spans={spans}
            transform={transform}
            colorLut={colorLut}
            colorBy={colorBy}
            colorField={colorField}
            valueRange={colorDomain}
            showKnotLines={showKnotLines}
            readCounts={readCounts}
            onValues={handleValues}
          />
          {buffers.map(({ positions, index }, p) => (
            // eslint-disable-next-line react/no-array-index-key -- patches don't move
            <NurbsDepthMesh key={p} positions={positions} index={index} />
          ))}
        </>
      )}
      {showControlNet &&
        worldSurfaces.map((surface, p) => (
          <NurbsControlNet
            // eslint-disable-next-line react/no-array-index-key -- patches don't move
            key={p}
            surface={surface}
            color={CONTROL_NET_COLOR}
          />
        ))}
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
