import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useSyncExternalStore } from 'react';
import { Color } from 'three';

import {
  type CanvasPanelEntry,
  type CanvasPanelRegistry,
  canvasPanels,
} from './multi-canvas';
import PanelPortal from './PanelPortal';

interface Props {
  registry: CanvasPanelRegistry;
  scroller: HTMLElement | null; // element the panels scroll in
}

const clearColor = new Color();

function getVisibleRect(
  entry: CanvasPanelEntry,
  canvas: DOMRect,
): DOMRect | undefined {
  const rect = entry.element.getBoundingClientRect();
  return rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > canvas.top &&
    rect.top < canvas.bottom &&
    rect.right > canvas.left &&
    rect.left < canvas.right
    ? rect
    : undefined;
}

/* Scenes of the panels of a `MultiVisCanvas`, each drawn in its area (only those in view) instead
 * of R3F's default render, and drawn again when panels move (scroll, layout changes) */
function PanelRenderer(props: Props) {
  const { registry, scroller } = props;
  const ids = useSyncExternalStore(registry.subscribeIds, registry.getIds);
  const invalidate = useThree((state) => state.invalidate);
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    canvasPanels.set(canvas, registry);
    return () => {
      canvasPanels.delete(canvas);
    };
  }, [canvas, registry]);

  useFrame(({ gl }) => {
    const canvasRect = gl.domElement.getBoundingClientRect();
    gl.setScissorTest(false);
    gl.setClearColor(gl.getClearColor(clearColor), gl.getClearAlpha()); // in case nothing was drawn yet (e.g. no panel in view)
    gl.clear();
    gl.setScissorTest(true);

    for (const entry of registry.entries.values()) {
      const rect = getVisibleRect(entry, canvasRect);
      if (rect) {
        const left = rect.left - canvasRect.left;
        const bottom = canvasRect.bottom - rect.bottom;
        gl.setViewport(left, bottom, rect.width, rect.height);
        gl.setScissor(left, bottom, rect.width, rect.height);
        gl.render(entry.scene, entry.camera);
      }
    }

    gl.setScissorTest(false);
  }, 1);

  useEffect(() => {
    if (!scroller) {
      return undefined;
    }
    function onMove() {
      invalidate();
    }
    scroller.addEventListener('scroll', onMove, { passive: true });
    const observer = new ResizeObserver(onMove);
    for (const child of scroller.children) {
      observer.observe(child);
    }
    return () => {
      scroller.removeEventListener('scroll', onMove);
      observer.disconnect();
    };
  }, [scroller, invalidate]);

  return ids.map((id) => <PanelPortal key={id} registry={registry} id={id} />);
}

export default PanelRenderer;
