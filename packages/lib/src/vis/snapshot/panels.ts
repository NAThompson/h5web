/* eslint-disable no-param-reassign -- objects are hidden while a panel is rendered */
import { _roots } from '@react-three/fiber';
import { type Object3D, Vector2, type WebGLRenderer } from 'three';

import {
  type CanvasPanelEntry,
  canvasPanels,
  SCROLLER_ATTR,
} from '../shared/multi-canvas';

export interface CanvasPanels {
  gl: WebGLRenderer;
  entries: CanvasPanelEntry[];
}

/* Panels drawn in the shared canvas of a `MultiVisCanvas`, if it is one */
export function getCanvasPanels(
  canvas: HTMLCanvasElement,
): CanvasPanels | undefined {
  const registry = canvasPanels.get(canvas);
  const state = _roots.get(canvas)?.store.getState();
  return registry && state
    ? { gl: state.gl, entries: [...registry.entries.values()] }
    : undefined;
}

/* Scene of a panel alone, in a copy of the canvas of the panel's size, whether it is in view or
 * not; the shared canvas is drawn again on the next frame */
export function renderPanel(
  gl: WebGLRenderer,
  entry: CanvasPanelEntry,
  pixelRatio: number,
  hidden: Object3D[] = [],
): HTMLCanvasElement {
  const { scene, camera, width, height } = entry;
  const visibility = hidden.map((obj) => obj.visible);
  const prevRatio = gl.getPixelRatio();
  const prevSize = gl.getSize(new Vector2());

  try {
    hidden.forEach((obj) => {
      obj.visible = false;
    });
    gl.setPixelRatio(pixelRatio);
    gl.setSize(width, height, false); // drawing buffer only (and viewport)
    gl.setScissorTest(false);
    gl.clear();
    gl.render(scene, camera);

    const copy = document.createElement('canvas');
    copy.width = gl.domElement.width;
    copy.height = gl.domElement.height;
    copy.getContext('2d')?.drawImage(gl.domElement, 0, 0);
    return copy;
  } finally {
    hidden.forEach((obj, i) => {
      obj.visible = visibility[i];
    });
    gl.setPixelRatio(prevRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    _roots.get(gl.domElement)?.store.getState().invalidate(); // before the browser paints
  }
}

/* Enlarge `root` so that the panels of the `MultiVisCanvas` in it don't scroll (all of them are
 * laid out in view) until the returned function is called. Elements keep their size (it changes
 * once the browser lays out again), so this is for synchronous snapshots. */
export function expandScrollers(root: HTMLElement): () => void {
  const scrollers = [
    ...root.querySelectorAll<HTMLElement>(`[${SCROLLER_ATTR}]`),
  ].filter(
    (elem) =>
      elem.scrollWidth > elem.clientWidth ||
      elem.scrollHeight > elem.clientHeight,
  );
  if (scrollers.length === 0) {
    return () => {};
  }

  // Overflow beyond the scroller with its scroll bars, as they go
  const extraWidth = Math.max(
    ...scrollers.map((elem) => elem.scrollWidth - elem.offsetWidth),
    0,
  );
  const extraHeight = Math.max(
    ...scrollers.map((elem) => elem.scrollHeight - elem.offsetHeight),
    0,
  );

  const { width, height } = root.getBoundingClientRect();
  const { cssText } = root.style;
  const scrolls = scrollers.map((elem) => [elem.scrollLeft, elem.scrollTop]);
  Object.entries({
    'box-sizing': 'border-box',
    flex: 'none',
    width: `${width + extraWidth}px`,
    height: `${height + extraHeight}px`,
    'max-width': 'none',
    'max-height': 'none',
  }).forEach(([prop, value]) => {
    root.style.setProperty(prop, value, 'important');
  });

  return () => {
    root.style.cssText = cssText;
    scrollers.forEach((elem, i) => {
      [elem.scrollLeft, elem.scrollTop] = scrolls[i];
    });
  };
}
