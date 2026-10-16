import {
  createPortal,
  type EventManager,
  type RootState,
} from '@react-three/fiber';
import { useMemo, useSyncExternalStore } from 'react';

import { type CanvasPanelRegistry } from './multi-canvas';
import PanelSize from './PanelSize';

interface Props {
  registry: CanvasPanelRegistry;
  id: string;
}

/* Scene of a panel, with its own camera, size and pointer events (in its area) */
function PanelPortal(props: Props) {
  const { registry, id } = props;
  const entry = useSyncExternalStore(
    (listener) => registry.subscribeEntry(id, listener),
    () => registry.entries.get(id),
  );

  const element = entry?.element;
  const events = useMemo<Partial<EventManager<HTMLElement>>>(
    () => ({
      // Pointer in the panel's area, if it is there (else no raycasting in the panel)
      compute: (event: MouseEvent, state: RootState) => {
        if (!element) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
          return;
        }
        state.pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
        state.raycaster.setFromCamera(state.pointer, state.camera);
      },
    }),
    [element],
  );

  if (!entry) {
    return null;
  }

  const { scene, camera, width, height, node } = entry;
  return createPortal(
    <>
      <PanelSize width={width} height={height} camera={camera} />
      {node}
    </>,
    scene,
    { camera, size: { width, height, top: 0, left: 0 }, events },
  );
}

export default PanelPortal;
