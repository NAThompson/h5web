import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';

import { type ParamSurfaceBuffers, weldSeamNormals } from './utils';

interface Props {
  buffers: ParamSurfaceBuffers;
  rows: number;
  cols: number;
  colors: Float32Array; // linear RGB colour of each vertex
  showSurface: boolean;
  showWireframe: boolean;
  shading: boolean;
  edgeColor: string; // colour of wireframe when drawn on top of surface
}

function ParamSurfaceMesh(props: Props) {
  const {
    buffers,
    rows,
    cols,
    colors,
    showSurface,
    showWireframe,
    shading,
    edgeColor,
  } = props;

  const invalidate = useThree((state) => state.invalidate);

  // Surface and wireframe share the same vertices (and colours)
  const [surfaceGeometry, wireGeometry] = useMemo(() => {
    const { positions, index, edges } = buffers;
    const positionAttr = new BufferAttribute(positions, 3);

    const surface = new BufferGeometry();
    surface.setAttribute('position', positionAttr);
    surface.setIndex(new BufferAttribute(index, 1));
    surface.computeVertexNormals();
    weldSeamNormals(
      positions,
      surface.getAttribute('normal').array as Float32Array,
      rows,
      cols,
    );
    surface.computeBoundingSphere();

    const wire = new BufferGeometry();
    wire.setAttribute('position', positionAttr);
    wire.setIndex(new BufferAttribute(edges, 1));
    wire.computeBoundingSphere();

    return [surface, wire];
  }, [buffers, rows, cols]);

  useEffect(
    () => () => {
      surfaceGeometry.dispose();
      wireGeometry.dispose();
    },
    [surfaceGeometry, wireGeometry],
  );

  // Update colours alone when colour map, domain or scale change (before next frame is rendered)
  useLayoutEffect(() => {
    const colorAttr = new BufferAttribute(colors, 3);
    surfaceGeometry.setAttribute('color', colorAttr);
    wireGeometry.setAttribute('color', colorAttr);
    invalidate();
  }, [surfaceGeometry, wireGeometry, colors, invalidate]);

  return (
    <>
      <mesh geometry={surfaceGeometry} visible={showSurface}>
        {shading ? (
          <meshLambertMaterial
            key="lit"
            vertexColors
            side={DoubleSide}
            polygonOffset // keep wireframe visible on top of surface
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        ) : (
          <meshBasicMaterial
            key="unlit"
            vertexColors
            side={DoubleSide}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        )}
      </mesh>
      <lineSegments geometry={wireGeometry} visible={showWireframe}>
        {showSurface ? (
          <lineBasicMaterial
            key="edges"
            color={edgeColor}
            transparent
            opacity={0.35}
          />
        ) : (
          <lineBasicMaterial key="wires" vertexColors />
        )}
      </lineSegments>
    </>
  );
}

export default ParamSurfaceMesh;
