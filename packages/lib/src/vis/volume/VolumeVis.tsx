import {
  type Domain,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { BoxGeometry, EdgesGeometry } from 'three';

import { type ColorMap } from '../heatmap/models';
import {
  type ClassStyleAttrs,
  type ValueTransform,
  type VisScaleType,
} from '../models';
import R3FCanvas from '../shared/R3FCanvas';
import { createScale, getTextContent } from '../utils';
import CanvasOverlay from './CanvasOverlay';
import Isosurfaces from './Isosurfaces';
import {
  type AxisValues,
  IsoColorMode,
  type IsosurfaceParams,
  type VolumePointSet,
  VolumeQuality,
  VolumeRenderMode,
} from './models';
import {
  getAxisLookup,
  getBoxSize,
  hasPoints,
  normalizeBoxSize,
} from './utils';
import VolumeControls from './VolumeControls';
import VolumeLegend from './VolumeLegend';
import VolumeMesh, { type AxisLookups } from './VolumeMesh';
import VolumePoints from './VolumePoints';
import styles from './VolumeVis.module.css';

const NO_AXIS_VALUES: AxisValues = [undefined, undefined, undefined];

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  title?: ReactNode;
  domain: Domain;
  scaleType?: VisScaleType; // e.g. symlog with its constant
  colorMap?: ColorMap;
  invertColorMap?: boolean;
  valueTransform?: ValueTransform; // values are logarithms: colour bar as powers
  mode?: VolumeRenderMode;
  opacity?: number;
  threshold?: number;
  quality?: VolumeQuality;
  showBox?: boolean;
  background?: string;
  /* Hide the volume rendering, e.g. to show isosurfaces alone */
  showVolume?: boolean;
  isosurfaces?: IsosurfaceParams[];
  isoColorMode?: IsoColorMode;
  /* Domain of gradient magnitudes, for colouring isosurfaces in `IsoColorMode.Gradient` */
  gradientDomain?: Domain;
  gradientLabel?: string;
  /* Extraction progress in [0, 1], shown while isosurfaces are being computed */
  isoProgress?: number;
  /* Message about isosurfaces (e.g. an error or a hint), shown over the canvas */
  isoMessage?: string;
  /* Physical size of the volume along x, y and z (defaults to the shape) */
  boxSize?: [number, number, number];
  /* Coordinates of the voxels along x, y and z: voxels of non-uniform axes (cf.
   * `isNonUniformAxis`) are placed at their coordinates within the box */
  axisValues?: AxisValues;
  /* Opaque points inside the volume, at coordinates along its axes (e.g. overlays) */
  points?: VolumePointSet[];
  /* Coverage of the voxels from 0 to 255, e.g. smoothed mask of the values inside a resampled
   * mesh (NaN outside): voxels with coverage below half are not rendered, so the boundary is a
   * smooth surface rather than a voxel staircase */
  coverage?: Uint8Array;
}

function VolumeVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    title,
    domain,
    colorMap = 'Inferno',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    valueTransform,
    mode = VolumeRenderMode.DVR,
    opacity = 0.25,
    threshold = 0.1,
    quality = VolumeQuality.Medium,
    showBox = true,
    background = 'black',
    showVolume = true,
    isosurfaces = [],
    isoColorMode,
    gradientDomain,
    gradientLabel,
    isoProgress,
    isoMessage,
    boxSize: customBoxSize,
    axisValues = NO_AXIS_VALUES,
    points,
    coverage,
    children,
    className = '',
    style,
  } = props;

  if (dataArray.shape.length !== 3) {
    throw new Error('Expected three-dimensional array');
  }

  // MIP and DVR spend the colors on [threshold, 1] of the normalized values (cf. `thresholdColor`)
  const legendDomain = useMemo((): Domain => {
    if (!showVolume || mode === VolumeRenderMode.Iso || threshold <= 0) {
      return domain;
    }
    const scale = createScale(scaleType, {
      domain,
      range: [0, 1],
      clamp: true,
    });
    return [scale.invert(threshold), domain[1]];
  }, [showVolume, mode, threshold, domain, scaleType]);

  const interactingRef = useRef(false);
  const edges = useMemo(() => {
    const box = new BoxGeometry();
    const geometry = new EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, []);
  useEffect(() => () => edges.dispose(), [edges]);

  const [depth, rows, cols] = dataArray.shape;
  const [xValues, yValues, zValues] = axisValues;
  const axisLookups = useMemo(
    (): AxisLookups => [
      getAxisLookup(xValues, cols),
      getAxisLookup(yValues, rows),
      getAxisLookup(zValues, depth),
    ],
    [xValues, yValues, zValues, cols, rows, depth],
  );

  const boxSize = customBoxSize
    ? normalizeBoxSize(customBoxSize)
    : getBoxSize(dataArray.shape);

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
    >
      <div className={styles.canvasArea}>
        <R3FCanvas className={styles.canvas} ambientIntensity={0.35}>
          <color attach="background" args={[background]} />
          <VolumeControls interactingRef={interactingRef} />
          <Isosurfaces
            isosurfaces={isosurfaces}
            shape={dataArray.shape}
            boxSize={boxSize}
            axisValues={axisValues}
            colorMode={isoColorMode}
            gradientDomain={gradientDomain}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
          />
          <VolumePoints
            points={points}
            shape={dataArray.shape}
            boxSize={boxSize}
            axisValues={axisValues}
            domain={domain}
            scaleType={scaleType}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
          />
          {showVolume && (
            <VolumeMesh
              boxSize={boxSize}
              axisLookups={axisLookups}
              withSurfaceDepth={isosurfaces.some(({ opacity: o }) => o >= 1)}
              withPointDepth={hasPoints(points)}
              dataArray={dataArray}
              coverage={coverage}
              domain={domain}
              scaleType={scaleType}
              colorMap={colorMap}
              invertColorMap={invertColorMap}
              mode={mode}
              opacity={opacity}
              threshold={threshold}
              quality={quality}
              interactingRef={interactingRef}
            />
          )}
          <lineSegments
            geometry={edges}
            scale={boxSize}
            visible={showBox}
            renderOrder={1}
          >
            <lineBasicMaterial
              color="white"
              transparent
              opacity={0.2}
              depthTest={false}
            />
          </lineSegments>
          {children}
        </R3FCanvas>
        <CanvasOverlay
          title={title}
          isoProgress={isoProgress}
          isoMessage={isoMessage}
        />
      </div>
      <VolumeLegend
        domain={legendDomain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        valueTransform={valueTransform}
        showVolume={showVolume}
        gradientDomain={
          isoColorMode === IsoColorMode.Gradient && isosurfaces.length > 0
            ? gradientDomain
            : undefined
        }
        gradientLabel={gradientLabel}
      />
    </figure>
  );
}

export type { Props as VolumeVisProps };
export default VolumeVis;
