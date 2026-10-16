import { type VisibleDomains } from '@h5web/shared/vis-models';
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useRef } from 'react';
import { Vector3 } from 'three';

import { useMoveCameraTo } from '../../interactions/hooks';
import { PanelInternalsContext } from './multi-canvas';
import { useVisCanvasContext } from './VisCanvasProvider';

function toKey({ xVisibleDomain, yVisibleDomain }: VisibleDomains): string {
  return [...xVisibleDomain, ...yVisibleDomain]
    .map((val) => val.toPrecision(6))
    .join(',');
}

/* Zoom and pan panels together: the data in view in a panel when it changes (e.g. zoomed) is
 * brought into view in the others with the same link key, whatever their size */
function PanelViewLink() {
  const panel = useContext(PanelInternalsContext);
  const camera = useThree((state) => state.camera);
  const { canvasSize, visRatio, dataToWorld, getVisibleDomains } =
    useVisCanvasContext();
  const moveCameraTo = useMoveCameraTo();
  const shownKey = useRef<string>(undefined); // last domains shared or brought into view

  useFrame(() => {
    if (!panel?.viewLink) {
      return;
    }
    const domains = getVisibleDomains(camera);
    const key = toKey(domains);
    if (key !== shownKey.current) {
      const isFirst = shownKey.current === undefined; // initial view: not shared
      shownKey.current = key;
      if (!isFirst) {
        panel.viewLink.set(domains, panel.id);
      }
    }
  });

  useEffect(() => {
    const link = panel?.viewLink;
    if (!link) {
      return undefined;
    }

    function show() {
      const state = link?.get();
      if (!state || state.source === panel?.id) {
        return;
      }
      const { xVisibleDomain, yVisibleDomain } = state.domains;
      const min = dataToWorld(
        new Vector3(xVisibleDomain[0], yVisibleDomain[0]),
      );
      const max = dataToWorld(
        new Vector3(xVisibleDomain[1], yVisibleDomain[1]),
      );
      const { width, height } = canvasSize;
      const scaleX = Math.min(Math.abs(max.x - min.x) / width, 1);
      const scaleY = Math.min(Math.abs(max.y - min.y) / height, 1);
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
        return; // e.g. data outside of a log axis
      }
      const scale = Math.max(scaleX, scaleY);
      camera.scale.set(
        visRatio === undefined ? scaleX : scale,
        visRatio === undefined ? scaleY : scale,
        1,
      );
      moveCameraTo(min.add(max).divideScalar(2));
      shownKey.current = toKey(getVisibleDomains(camera));
    }

    show(); // e.g. panel shown after the others were zoomed
    return link.subscribe(show);
  }, [
    panel,
    camera,
    canvasSize,
    visRatio,
    dataToWorld,
    getVisibleDomains,
    moveCameraTo,
  ]);

  return null;
}

export default PanelViewLink;
