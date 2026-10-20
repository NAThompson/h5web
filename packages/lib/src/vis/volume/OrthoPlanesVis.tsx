import {
  type Domain,
  type IgnoreValue,
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
import { type ClassStyleAttrs, type VisScaleType } from '../models';
import R3FCanvas from '../shared/R3FCanvas';
import { getTextContent } from '../utils';
import CanvasOverlay from './CanvasOverlay';
import { type AxisValues, type OrthoPoint } from './models';
import OrthoPlanes from './OrthoPlanes';
import { getAxisLookup, getBoxSize, normalizeBoxSize } from './utils';
import VolumeControls from './VolumeControls';
import { type AxisLookups } from './VolumeMesh';
import styles from './VolumeVis.module.css';

const NO_AXIS_VALUES: AxisValues = [undefined, undefined, undefined];

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  point: OrthoPoint; // voxel through which the planes go
  title?: ReactNode;
  domain: Domain;
  scaleType?: VisScaleType;
  colorMap?: ColorMap;
  invertColorMap?: boolean;
  background?: string;
  ignoreValue?: IgnoreValue; // e.g. fill values: drawn as NaN
  nanColor?: string; // CSS colour of NaN and values unsupported by the scale
  belowColor?: string; // CSS colour of values below the domain (default: colour of its lower end)
  aboveColor?: string;
  /* Physical size of the volume along x, y and z (defaults to the shape) */
  boxSize?: [number, number, number];
  /* Coordinates of the voxels along x, y and z: planes of non-uniform axes are placed, and
   * sampled, at their coordinates (as `VolumeVis`) */
  axisValues?: AxisValues;
}

/* Three orthogonal slices of a volume through a voxel, in its bounding box, in 3D (the GPU samples
 * the volume's 3D texture: slicing needs no new upload) */
function OrthoPlanesVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    point,
    title,
    domain,
    scaleType = ScaleType.Linear,
    colorMap = 'Viridis',
    invertColorMap = false,
    background = 'black',
    ignoreValue,
    nanColor,
    belowColor,
    aboveColor,
    boxSize: customBoxSize,
    axisValues = NO_AXIS_VALUES,
    children,
    className = '',
    style,
  } = props;

  if (dataArray.shape.length !== 3) {
    throw new Error('Expected three-dimensional array');
  }

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
        <R3FCanvas className={styles.canvas}>
          <color attach="background" args={[background]} />
          <VolumeControls interactingRef={interactingRef} />
          <group scale={boxSize}>
            <OrthoPlanes
              dataArray={dataArray}
              point={point}
              domain={domain}
              scaleType={scaleType}
              colorMap={colorMap}
              invertColorMap={invertColorMap}
              axisLookups={axisLookups}
              ignoreValue={ignoreValue}
              nanColor={nanColor}
              belowColor={belowColor}
              aboveColor={aboveColor}
            />
            <lineSegments geometry={edges} renderOrder={1}>
              <lineBasicMaterial
                color="white"
                transparent
                opacity={0.35}
                depthTest={false}
              />
            </lineSegments>
          </group>
          {children}
        </R3FCanvas>
        <CanvasOverlay
          title={title}
          isoProgress={undefined}
          isoMessage={undefined}
        />
      </div>
    </figure>
  );
}

export type { Props as OrthoPlanesVisProps };
export default OrthoPlanesVis;
