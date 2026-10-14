import {
  type ColorScaleType,
  type Domain,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type PropsWithChildren, useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, EdgesGeometry } from 'three';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs } from '../models';
import R3FCanvas from '../shared/R3FCanvas';
import Isosurfaces from './Isosurfaces';
import {
  IsoColorMode,
  type IsosurfaceParams,
  VolumeQuality,
  VolumeRenderMode,
} from './models';
import { getBoxSize, normalizeBoxSize } from './utils';
import VolumeControls from './VolumeControls';
import VolumeLegend from './VolumeLegend';
import VolumeMesh from './VolumeMesh';
import styles from './VolumeVis.module.css';

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  domain: Domain;
  scaleType?: ColorScaleType;
  colorMap?: ColorMap;
  invertColorMap?: boolean;
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
}

function VolumeVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    domain,
    colorMap = 'Inferno',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    mode = VolumeRenderMode.DVR,
    opacity = 0.25,
    threshold = 0.1,
    quality = VolumeQuality.Medium,
    showBox = true,
    background = '#10131a',
    showVolume = true,
    isosurfaces = [],
    isoColorMode,
    gradientDomain,
    gradientLabel,
    isoProgress,
    isoMessage,
    boxSize: customBoxSize,
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

  const boxSize = customBoxSize
    ? normalizeBoxSize(customBoxSize)
    : getBoxSize(dataArray.shape);

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      data-keep-canvas-colors
    >
      <R3FCanvas className={styles.canvas} ambientIntensity={0.35}>
        <color attach="background" args={[background]} />
        <VolumeControls interactingRef={interactingRef} />
        <Isosurfaces
          isosurfaces={isosurfaces}
          shape={dataArray.shape}
          boxSize={boxSize}
          colorMode={isoColorMode}
          gradientDomain={gradientDomain}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
        />
        {showVolume && (
          <VolumeMesh
            boxSize={boxSize}
            dataArray={dataArray}
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
      <VolumeLegend
        domain={domain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        showVolume={showVolume}
        gradientDomain={
          isoColorMode === IsoColorMode.Gradient && isosurfaces.length > 0
            ? gradientDomain
            : undefined
        }
        gradientLabel={gradientLabel}
        isoProgress={isoProgress}
        isoMessage={isoMessage}
      />
    </figure>
  );
}

export type { Props as VolumeVisProps };
export default VolumeVis;
