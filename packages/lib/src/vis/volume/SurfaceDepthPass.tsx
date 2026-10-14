/* eslint-disable no-param-reassign -- the depth pass temporarily reconfigures the scene and camera */
import { useFrame } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo } from 'react';
import {
  DepthTexture,
  DoubleSide,
  type Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';

/* Layer of opaque isosurfaces, rendered to a depth texture before the volume */
export const SURFACE_DEPTH_LAYER = 1;

interface Props {
  volumeRef: RefObject<Mesh | null>;
  material: ShaderMaterial;
}

/*
 * Render opaque isosurfaces to a depth texture before each frame, so the volume's ray marcher
 * can stop rays where they hit a surface: only the volume in front of the surface is then
 * accumulated and blended over it. Takes over rendering of the canvas while mounted.
 */
function SurfaceDepthPass(props: Props) {
  const { volumeRef, material } = props;
  const { uniforms } = material;

  const target = useMemo(() => {
    const renderTarget = new WebGLRenderTarget(1, 1);
    renderTarget.depthTexture = new DepthTexture(1, 1);
    return renderTarget;
  }, []);

  const depthMaterial = useMemo(
    () => new MeshBasicMaterial({ colorWrite: false, side: DoubleSide }),
    [],
  );
  const size = useMemo(() => new Vector2(), []);

  useEffect(
    () => () => {
      uniforms.hasSurfaceDepth.value = false;
      target.dispose();
      depthMaterial.dispose();
    },
    [uniforms, target, depthMaterial],
  );

  useFrame(({ gl, scene, camera }) => {
    gl.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) {
      target.setSize(size.x, size.y);
    }

    // Depth of opaque surfaces only
    const { mask } = camera.layers;
    const { background, overrideMaterial } = scene;
    camera.layers.set(SURFACE_DEPTH_LAYER);
    scene.background = null;
    scene.overrideMaterial = depthMaterial;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    camera.layers.mask = mask;
    scene.background = background;
    scene.overrideMaterial = overrideMaterial;

    // Unproject depth samples straight into the volume's box space
    const volume = volumeRef.current;
    if (volume) {
      uniforms.surfaceDepth.value = target.depthTexture;
      (uniforms.depthTexelSize.value as Vector2).set(1 / size.x, 1 / size.y);
      (uniforms.depthToBox.value as Matrix4)
        .copy(volume.matrixWorld)
        .invert()
        .multiply(camera.matrixWorld)
        .multiply(camera.projectionMatrixInverse);
      uniforms.hasSurfaceDepth.value = true;
    }

    gl.render(scene, camera);
  }, 1);

  return null;
}

export default SurfaceDepthPass;
