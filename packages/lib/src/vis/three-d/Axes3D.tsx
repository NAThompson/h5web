import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { formatTick } from '@h5web/shared/vis-utils';
import { type Size, useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type Group,
  type Sprite,
  Vector3,
  type Vector3Tuple,
} from 'three';

import { type AxisTicks, type VisScaleType } from '../models';
import {
  createScale,
  formatPiTick,
  getScaleTickValues,
  getTickFormatter,
} from '../utils';
import TextSprite, { updateLabelSprite } from './TextSprite';
import { getAxisTicks } from './utils';

export interface Axis3DConfig {
  domain: Domain;
  isIndexAxis?: boolean; // integer ticks (X and Y axes only)
  scaleType?: VisScaleType; // Z axis only
  label?: string; // X and Y axes are labelled `x` and `y` by default; Z axis is not labelled by default
  flip?: boolean; // X and Y axes only
  ticks?: AxisTicks; // X and Y axes only
}

interface Props {
  boxSize: Vector3Tuple; // box spans [-w/2, w/2] x [-h/2, h/2] x [0, d]
  xConfig: Axis3DConfig;
  yConfig: Axis3DConfig;
  zConfig: Axis3DConfig;
  showGrid: boolean;
}

interface Theme {
  tickLabels: string;
  axisLabels: string;
  ticks: string;
  grid: string;
  gridOpacity: number;
  fontFamily: string;
}

const TICK_LENGTH = 0.025;
const TICK_LABEL_OFFSET = 0.04; // labels are anchored so they extend away from the box
const AXIS_LABEL_OFFSET = 0.16;
const Z_LABEL_OFFSET = 0.05; // along both X and Y, i.e. diagonally away from the corner
const TICK_FONT_SIZE = 11;
const LABEL_FONT_SIZE = 13;

function readTheme(elem: HTMLElement): Theme {
  const style = getComputedStyle(elem);
  function get(name: string, fallback: string): string {
    return style.getPropertyValue(name).trim() || fallback;
  }

  return {
    tickLabels: get('--h5w-tickLabels--color', '#333'),
    axisLabels: get('--h5w-axisLabels--color', '#333'),
    ticks: get('--h5w-ticks--color', 'gray'),
    grid: get('--h5w-grid--color', 'gray'),
    gridOpacity: Number(get('--h5w-grid--opacity', '0.33')),
    fontFamily: style.fontFamily || 'sans-serif',
  };
}

function serializeTheme(theme: Theme): string {
  return Object.values(theme).join('|');
}

/**
 * Read theme from CSS custom properties, and read it again whenever classes or inline
 * styles change in the document (e.g. theme switch) or the preferred colour scheme changes.
 */
function useTheme(elem: HTMLElement): Theme {
  const [theme, setTheme] = useState(() => readTheme(elem));

  useEffect(() => {
    let current = serializeTheme(readTheme(elem));

    function update() {
      const next = readTheme(elem);
      const serialized = serializeTheme(next);
      if (serialized !== current) {
        current = serialized;
        setTheme(next);
      }
    }

    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
      subtree: true,
    });

    const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, [elem]);

  return theme;
}

function useLineGeometry(points: number[]): BufferGeometry {
  const geometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from(points), 3),
    );
    return geom;
  }, [points]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** Which side of the box the camera is on, along X and Y (`1` or `-1`). */
function useCameraSides(): [number, number] {
  const [sides, setSides] = useState<[number, number]>([-1, -1]);
  const sidesRef = useRef(sides);

  useFrame(({ camera }) => {
    const sx = camera.position.x >= 0 ? 1 : -1;
    const sy = camera.position.y >= 0 ? 1 : -1;
    if (sx !== sidesRef.current[0] || sy !== sidesRef.current[1]) {
      sidesRef.current = [sx, sy];
      setSides([sx, sy]);
    }
  });

  return sides;
}

interface Rect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

const LABEL_PADDING = 2; // px

function getScreenRect(sprite: Sprite, camera: Camera, size: Size): Rect {
  const { width, height } = sprite.userData as {
    width: number;
    height: number;
  };
  const ndc = sprite.getWorldPosition(new Vector3()).project(camera);
  const x = ((ndc.x + 1) / 2) * size.width - sprite.center.x * width;
  const y = ((ndc.y + 1) / 2) * size.height - sprite.center.y * height;
  return { left: x, right: x + width, bottom: y, top: y + height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right + LABEL_PADDING &&
    b.left < a.right + LABEL_PADDING &&
    a.bottom < b.top + LABEL_PADDING &&
    b.bottom < a.top + LABEL_PADDING
  );
}

/**
 * Hide labels that overlap labels of higher priority on screen (e.g. value-axis labels
 * colliding with y-axis labels near the corner they share at low view angles).
 */
function useLabelCollisions(groupRef: RefObject<Group | null>): void {
  useFrame(({ camera, size }) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    const sprites = group.children
      .filter((child): child is Sprite => !!child.userData.isLabel)
      .sort(
        (a, b) =>
          (b.userData.priority as number) - (a.userData.priority as number),
      );

    const shown: Rect[] = [];
    for (const sprite of sprites) {
      updateLabelSprite(sprite, camera, size); // in case label was just added and not updated yet
      const rect = getScreenRect(sprite, camera, size);
      sprite.visible = !shown.some((other) => overlaps(rect, other));
      if (sprite.visible) {
        shown.push(rect);
      }
    }
  });
}

interface Label {
  key: string;
  text: string;
  position: Vector3Tuple;
  outward: Vector3Tuple; // direction away from the box, to anchor the label
  priority: number;
  isAxisLabel?: boolean;
}

const PRIORITY = { axisLabel: 3, tick: 2, valueTick: 1 };

/**
 * Box with ticks, tick labels and axis labels on its outer edges, and grid lines on its
 * floor and back walls - i.e. the walls furthest from the camera, whatever the view angle.
 */
function Axes3D(props: Props) {
  const { boxSize, xConfig, yConfig, zConfig, showGrid } = props;
  const { domain: valueDomain, scaleType = ScaleType.Linear } = zConfig;

  const [w, h, zHeight] = boxSize;
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const theme = useTheme(domElement);

  useEffect(() => invalidate(), [theme, invalidate]);

  const [sx, sy] = useCameraSides();

  const groupRef = useRef<Group>(null);
  useLabelCollisions(groupRef);

  const { axisPoints, gridPoints, labels } = useMemo(() => {
    const xScale = createScale(ScaleType.Linear, {
      domain: xConfig.domain,
      range: xConfig.flip ? [w / 2, -w / 2] : [-w / 2, w / 2],
    });
    const yScale = createScale(ScaleType.Linear, {
      domain: yConfig.domain,
      range: yConfig.flip ? [h / 2, -h / 2] : [-h / 2, h / 2],
    });
    const zScale = createScale(scaleType, {
      domain: valueDomain,
      range: [0, zHeight],
    });

    const xTicks = getAxisTicks(
      xConfig.domain,
      Math.max(Math.round(w * 6), 2),
      !!xConfig.isIndexAxis,
      xConfig.ticks,
    );
    const yTicks = getAxisTicks(
      yConfig.domain,
      Math.max(Math.round(h * 6), 2),
      !!yConfig.isIndexAxis,
      yConfig.ticks,
    );
    const formatX = xConfig.ticks === 'pi' ? formatPiTick : formatTick;
    const formatY = yConfig.ticks === 'pi' ? formatPiTick : formatTick;

    const zFormatter = getTickFormatter(
      valueDomain,
      300,
      Array.isArray(scaleType) ? scaleType[0] : scaleType,
    );
    // Flat box (e.g. planar curve): no Z axis to annotate
    const zCount = Math.max(Math.round(zHeight * 8), 2);
    const zTicks =
      zHeight > 0
        ? (
            getScaleTickValues(scaleType, valueDomain, zCount) ??
            zScale.ticks(zCount)
          ).filter((val) => zFormatter(val) !== '')
        : [];

    const xNear = (sx * w) / 2;
    const xFar = -xNear;
    const yNear = (sy * h) / 2;
    const yFar = -yNear;

    const axis: number[] = [];
    const grid: number[] = [];
    const texts: Label[] = [];

    function seg(arr: number[], a: Vector3Tuple, b: Vector3Tuple): void {
      arr.push(...a, ...b);
    }

    // Floor outline
    seg(axis, [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0]);
    seg(axis, [w / 2, -h / 2, 0], [w / 2, h / 2, 0]);
    seg(axis, [w / 2, h / 2, 0], [-w / 2, h / 2, 0]);
    seg(axis, [-w / 2, h / 2, 0], [-w / 2, -h / 2, 0]);

    // Back walls' vertical edges and z axis
    seg(axis, [xNear, yFar, 0], [xNear, yFar, zHeight]);
    seg(grid, [xFar, yFar, 0], [xFar, yFar, zHeight]);
    seg(grid, [xFar, yNear, 0], [xFar, yNear, zHeight]);

    xTicks.forEach((val) => {
      const x = xScale(val);
      seg(axis, [x, yNear, 0], [x, yNear + sy * TICK_LENGTH, 0]);
      if (showGrid) {
        seg(grid, [x, yNear, 0], [x, yFar, 0]);
        seg(grid, [x, yFar, 0], [x, yFar, zHeight]);
      }
      texts.push({
        key: `x${val}`,
        text: formatX(val),
        position: [x, yNear + sy * TICK_LABEL_OFFSET, 0],
        outward: [0, sy, 0],
        priority: PRIORITY.tick,
      });
    });

    yTicks.forEach((val) => {
      const y = yScale(val);
      seg(axis, [xNear, y, 0], [xNear + sx * TICK_LENGTH, y, 0]);
      if (showGrid) {
        seg(grid, [xNear, y, 0], [xFar, y, 0]);
        seg(grid, [xFar, y, 0], [xFar, y, zHeight]);
      }
      texts.push({
        key: `y${val}`,
        text: formatY(val),
        position: [xNear + sx * TICK_LABEL_OFFSET, y, 0],
        outward: [sx, 0, 0],
        priority: PRIORITY.tick,
      });
    });

    zTicks.forEach((val) => {
      const z = zScale(val);
      seg(axis, [xNear, yFar, z], [xNear, yFar - sy * TICK_LENGTH, z]);
      if (showGrid) {
        seg(grid, [xNear, yFar, z], [xFar, yFar, z]);
        seg(grid, [xFar, yFar, z], [xFar, yNear, z]);
      }
      texts.push({
        key: `z${val}`,
        text: formatTick(val),
        position: [xNear + sx * Z_LABEL_OFFSET, yFar - sy * Z_LABEL_OFFSET, z],
        outward: [sx, -sy, 0], // diagonally away from the corner, and from the surface
        priority: PRIORITY.valueTick,
      });
    });

    texts.push(
      {
        key: 'x-label',
        text: xConfig.label ?? 'x',
        position: [0, yNear + sy * AXIS_LABEL_OFFSET, 0],
        outward: [0, sy, 0],
        priority: PRIORITY.axisLabel,
        isAxisLabel: true,
      },
      {
        key: 'y-label',
        text: yConfig.label ?? 'y',
        position: [xNear + sx * AXIS_LABEL_OFFSET, 0, 0],
        outward: [sx, 0, 0],
        priority: PRIORITY.axisLabel,
        isAxisLabel: true,
      },
    );

    if (zConfig.label && zHeight > 0) {
      texts.push({
        key: 'z-label',
        text: zConfig.label,
        position: [xNear, yFar, zHeight + TICK_LABEL_OFFSET],
        outward: [0, 0, 1],
        priority: PRIORITY.axisLabel,
        isAxisLabel: true,
      });
    }

    return { axisPoints: axis, gridPoints: grid, labels: texts };
  }, [
    w,
    h,
    zHeight,
    sx,
    sy,
    xConfig,
    yConfig,
    zConfig,
    valueDomain,
    scaleType,
    showGrid,
  ]);

  const axisGeometry = useLineGeometry(axisPoints);
  const gridGeometry = useLineGeometry(gridPoints);

  return (
    <group ref={groupRef}>
      <lineSegments geometry={gridGeometry}>
        <lineBasicMaterial
          color={theme.grid}
          transparent
          opacity={theme.gridOpacity}
          depthWrite={false}
        />
      </lineSegments>
      <lineSegments geometry={axisGeometry}>
        <lineBasicMaterial color={theme.ticks} />
      </lineSegments>
      {labels.map(({ key, text, position, outward, priority, isAxisLabel }) => (
        <TextSprite
          key={key}
          priority={priority}
          text={text}
          position={position}
          outward={outward}
          color={isAxisLabel ? theme.axisLabels : theme.tickLabels}
          fontSize={isAxisLabel ? LABEL_FONT_SIZE : TICK_FONT_SIZE}
          fontWeight={isAxisLabel ? 600 : 400}
          fontFamily={theme.fontFamily}
        />
      ))}
    </group>
  );
}

export default Axes3D;
