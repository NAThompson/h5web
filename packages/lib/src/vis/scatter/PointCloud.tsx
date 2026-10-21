import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  type Layers,
  ShaderMaterial,
  Vector2,
  type Vector3Tuple,
} from 'three';

import { GlyphType } from '../line/models';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';

interface Props {
  positions: Float32Array; // in the unit square / cube, 3 per point (cf. `getUnitPositions`)
  colors: Uint8Array; // sRGB, 3 per point (cf. `getPointColors`)
  sizes: Float32Array; // diameters in CSS pixels; `0` hides a point (cf. `getPointSizes`)
  boxSize?: Vector3Tuple; // unit cube drawn in [-w/2, w/2] x [-h/2, h/2] x [0, d] (default: 2D vis)
  sizeScale?: number; // multiplies all sizes
  opacity?: number;
  layers?: Layers; // e.g. to render points in a depth pass too
  sphereDepth?: boolean; // at the depth of the front of a sphere of their size (cf. shader)
}

/* Disc of `size` CSS pixels whatever the distance to the camera (pixel ratio from the renderer,
 * so snapshots rendered at a higher resolution keep sizes). Hidden points are moved out of the
 * clip volume. Like `GlyphMaterial` (for SVG snapshots): `glyphType` in `userData`, and `size`
 * uniform, which scales the per-point `pointSize` attribute.
 * With `SPHERE_DEPTH`, a disc lies at the depth of the front of a sphere of its size, so that it's
 * hidden (or cut, e.g. by a plane through its centre) only by surfaces in front of that sphere. */
const VERTEX_SHADER = `
  attribute float pointSize;
  uniform float size;
  uniform float pixelRatio;
  uniform float viewportHeight; // in device pixels
  varying vec3 vColor;

  void main() {
    vColor = color;
    float px = pointSize * size * pixelRatio;
    gl_PointSize = px;
    if (px <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #ifdef SPHERE_DEPTH
      float radius = px * gl_Position.w / (viewportHeight * projectionMatrix[1][1]); // view units
      vec4 front = projectionMatrix * vec4(mvPosition.xyz + vec3(0.0, 0.0, radius), 1.0);
      gl_Position.z = front.z / front.w * gl_Position.w;
    #endif
  }
`;

const FRAGMENT_SHADER = `
  uniform float opacity;
  varying vec3 vColor;

  void main() {
    if (distance(gl_PointCoord, vec2(0.5)) > 0.5) {
      discard;
    }
    gl_FragColor = vec4(vColor, opacity);
  }
`;

function setAttribute(
  geometry: BufferGeometry,
  name: string,
  array: Float32Array | Uint8Array,
  itemSize: number,
): void {
  const current = geometry.getAttribute(name) as BufferAttribute | undefined;
  if (current?.array.length === array.length) {
    current.array.set(array); // same GPU buffer
    current.needsUpdate = true;
    return;
  }
  geometry.setAttribute(
    name,
    new BufferAttribute(array, itemSize, array instanceof Uint8Array),
  );
}

/** Points of a scatter plot or point cloud, uploaded once to the GPU. */
function PointCloud(props: Props) {
  const {
    positions,
    colors,
    sizes,
    boxSize,
    sizeScale = 1,
    opacity = 1,
    layers,
    sphereDepth = false,
  } = props;
  const { visSize } = useVisCanvasContext(); // within `VisCanvas`
  const [w, h, d] = boxSize ?? [visSize.width, visSize.height, 1];
  const invalidate = useThree((state) => state.invalidate);

  const geometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    return geom;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    setAttribute(geometry, 'color', colors, 3);
    setAttribute(geometry, 'pointSize', sizes, 1);
    invalidate();
  }, [geometry, colors, sizes, invalidate]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          size: { value: 1 },
          opacity: { value: 1 },
          pixelRatio: { value: 1 },
          viewportHeight: { value: 1 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        vertexColors: true,
        userData: { glyphType: GlyphType.Circle },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const isTranslucent = opacity < 1;
  useLayoutEffect(() => {
    material.transparent = isTranslucent;
    material.depthWrite = !isTranslucent; // translucent points must not hide each other
    material.defines = sphereDepth ? { SPHERE_DEPTH: '' } : {};
    material.needsUpdate = true; // uniforms below need no update of the program
  }, [material, isTranslucent, sphereDepth]);

  const drawingSize = useMemo(() => new Vector2(), []);

  useLayoutEffect(() => {
    material.uniforms.size.value = sizeScale;
    material.uniforms.opacity.value = opacity;
    invalidate();
  }, [material, sizeScale, opacity, invalidate]);

  return (
    <points
      geometry={geometry}
      material={material}
      layers={layers}
      position={[-w / 2, -h / 2, 0]}
      scale={[w, h, d].map((side) => Math.max(side, 1e-6)) as Vector3Tuple} // flat box: invertible
      frustumCulled={false}
      onBeforeRender={(renderer) => {
        material.uniforms.pixelRatio.value = renderer.getPixelRatio();
        material.uniforms.viewportHeight.value =
          renderer.getRenderTarget()?.height ??
          renderer.getDrawingBufferSize(drawingSize).y;
      }}
    />
  );
}

export type { Props as PointCloudProps };
export default PointCloud;
