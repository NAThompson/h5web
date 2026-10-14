import { type Domain } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { rgb } from 'd3-color';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Mesh,
  SRGBColorSpace,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import { getInterpolator } from '../heatmap/utils';
import { type IsosurfaceGeometry } from './marchingCubes';
import { IsoColorMode } from './models';
import { SURFACE_DEPTH_LAYER } from './SurfaceDepthPass';

interface Props {
  geometry: IsosurfaceGeometry;
  shape: number[];
  boxSize: [number, number, number];
  color: string;
  opacity: number;
  colorMode: IsoColorMode;
  gradientDomain: Domain | undefined;
  colorMap: ColorMap;
  invertColorMap: boolean;
  renderOrder?: number;
}

const LUT_SIZE = 256;

/* Colour map in linear RGB, as expected for vertex colours (colour maps are defined in sRGB) */
export function getColorLut(colorMap: ColorMap, invert: boolean): Float32Array {
  const interpolator = getInterpolator(colorMap, invert);
  const lut = new Float32Array(LUT_SIZE * 3);
  const color = new Color();
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const { r, g, b } = rgb(interpolator(i / (LUT_SIZE - 1)));
    color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
    lut[i * 3] = color.r;
    lut[i * 3 + 1] = color.g;
    lut[i * 3 + 2] = color.b;
  }
  return lut;
}

/* Per-vertex colours from gradient magnitudes */
export function getGradientColors(
  gradients: Float32Array,
  domain: Domain,
  lut: Float32Array,
): Float32Array {
  const colors = new Float32Array(gradients.length * 3);
  const [min, max] = domain;
  const range = max - min;
  gradients.forEach((val, i) => {
    const t = range > 0 ? (val - min) / range : 0;
    const idx = Math.round(Math.min(Math.max(t, 0), 1) * (LUT_SIZE - 1)) * 3;
    colors[i * 3] = lut[idx];
    colors[i * 3 + 1] = lut[idx + 1];
    colors[i * 3 + 2] = lut[idx + 2];
  });
  return colors;
}

function IsosurfaceMesh(props: Props) {
  const {
    geometry,
    shape,
    boxSize,
    color,
    opacity,
    colorMode,
    gradientDomain,
    colorMap,
    invertColorMap,
    renderOrder,
  } = props;

  const bufferGeometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(geometry.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(geometry.normals, 3));
    geom.setIndex(new BufferAttribute(geometry.indices, 1));
    return geom;
  }, [geometry]);

  useEffect(() => () => bufferGeometry.dispose(), [bufferGeometry]);

  const colorDomain =
    colorMode === IsoColorMode.Gradient ? gradientDomain : undefined;
  const withGradient = !!colorDomain;
  const lut = useMemo(
    () => getColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (colorDomain) {
      const colors = getGradientColors(geometry.gradients, colorDomain, lut);
      bufferGeometry.setAttribute('color', new BufferAttribute(colors, 3));
    } else {
      bufferGeometry.deleteAttribute('color');
    }
    invalidate();
  }, [bufferGeometry, geometry, colorDomain, lut, invalidate]);

  // Index coordinates of grid points (voxel centres) to the volume's bounding box
  const [depth, rows, cols] = shape;
  const sizes = [cols, rows, depth];
  const scale = boxSize.map((size, i) => size / sizes[i]) as [
    number,
    number,
    number,
  ];
  const position = boxSize.map((size, i) => size * (0.5 / sizes[i] - 0.5)) as [
    number,
    number,
    number,
  ];

  const isOpaque = opacity >= 1;

  // Opaque surfaces stop the volume's rays (cf. `SurfaceDepthPass`)
  const meshRef = useRef<Mesh>(null);
  useLayoutEffect(() => {
    const layers = meshRef.current?.layers;
    if (isOpaque) {
      layers?.enable(SURFACE_DEPTH_LAYER);
    } else {
      layers?.disable(SURFACE_DEPTH_LAYER);
    }
    invalidate();
  }, [isOpaque, invalidate]);

  return (
    <mesh
      ref={meshRef}
      geometry={bufferGeometry}
      scale={scale}
      position={position}
      renderOrder={renderOrder}
    >
      <meshStandardMaterial
        key={withGradient ? 'gradient' : 'solid'} // recompile shader when toggling vertex colours
        color={withGradient ? 'white' : color}
        vertexColors={withGradient}
        side={DoubleSide}
        roughness={0.55}
        metalness={0.05}
        transparent={!isOpaque}
        opacity={opacity}
        depthWrite={isOpaque}
      />
    </mesh>
  );
}

export type { Props as IsosurfaceMeshProps };
export default IsosurfaceMesh;
