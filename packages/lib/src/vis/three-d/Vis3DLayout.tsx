import { type Domain } from '@h5web/shared/vis-models';
import { type PropsWithChildren, type ReactNode, useRef } from 'react';
import { type Vector3Tuple } from 'three';

import ColorBar from '../heatmap/ColorBar';
import { type ColorMap } from '../heatmap/models';
import {
  type ClassStyleAttrs,
  type ValueTransform,
  type VisScaleType,
} from '../models';
import R3FCanvas from '../shared/R3FCanvas';
import { getTextContent } from '../utils';
import Headlight from './Headlight';
import OrbitFraming from './OrbitFraming';
import styles from './Vis3D.module.css';

/* Lambert shading: lit colour = colour * (ambient + directional * cos(angle)) / PI.
 * `R3FCanvas` already provides an ambient light of intensity 1. Intensities are chosen so that
 * ambient and directional contributions sum to exactly PI: faces facing the light keep the exact
 * colour of the colour map (no clipping), while faces turned away get darker (down to 55%). */
const AMBIENT_SHARE = 0.55;
const EXTRA_AMBIENT_INTENSITY = AMBIENT_SHARE * Math.PI - 1;
const DIRECTIONAL_INTENSITY = (1 - AMBIENT_SHARE) * Math.PI;
const LIGHT_POSITION: Vector3Tuple = [-0.2, -0.3, 1]; // mostly from above, so flat areas stay faithful

interface Props extends ClassStyleAttrs {
  title?: ReactNode;
  boxSize: Vector3Tuple; // box spans [-w/2, w/2] x [-h/2, h/2] x [0, d]
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  colorBarLabel?: ReactNode;
  valueTransform?: ValueTransform; // values are logarithms: colour bar as powers
  belowColor?: string; // shown at the ends of the colour bar
  aboveColor?: string;
  headlight?: boolean; // light follows camera, rather than lighting the box from above
}

/**
 * Layout shared by 3D visualizations: title, canvas with lights and orbit controls framing
 * the box, "Reset view" button and colour bar. Scene content is passed as children.
 */
function Vis3DLayout(props: PropsWithChildren<Props>) {
  const {
    title,
    boxSize,
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    colorBarLabel,
    valueTransform,
    belowColor,
    aboveColor,
    headlight = false,
    children,
    className = '',
    style,
  } = props;

  const resetRef = useRef<() => void>(undefined);

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
    >
      <div className={styles.main}>
        {title && <p className={styles.title}>{title}</p>}
        <div className={styles.canvasArea}>
          <R3FCanvas className={styles.canvas}>
            {headlight ? (
              <Headlight />
            ) : (
              <>
                <ambientLight intensity={EXTRA_AMBIENT_INTENSITY} />
                <directionalLight
                  position={LIGHT_POSITION}
                  intensity={DIRECTIONAL_INTENSITY}
                />
              </>
            )}
            <OrbitFraming boxSize={boxSize} resetRef={resetRef} />
            {children}
          </R3FCanvas>
          <button
            className={styles.resetBtn}
            type="button"
            data-snapshot-ignore
            onClick={() => resetRef.current?.()}
          >
            <span className={styles.btnLike}>Reset view</span>
          </button>
        </div>
      </div>
      <ColorBar
        domain={domain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        withBounds
        label={colorBarLabel}
        valueTransform={valueTransform}
        belowColor={belowColor}
        aboveColor={aboveColor}
      />
    </figure>
  );
}

export default Vis3DLayout;
