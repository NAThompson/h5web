import { assertNonNull } from '@h5web/shared/guards';
import { useContextBridge } from 'its-fine';
import {
  type PropsWithChildren,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { Scene } from 'three';

import {
  MultiCanvasContext,
  PanelInternalsContext,
  VisPanelContext,
} from './multi-canvas';
import styles from './MultiVisCanvas.module.css';
import { ScaledOrthographicCamera } from './ScaledOrthographicCamera';

interface Props {
  className?: string;
}

/* Stand-in for `R3FCanvas` within a `MultiVisCanvas`: the R3F children are drawn in this
 * element's area of the shared canvas (behind it), with the context they are rendered in */
function CanvasPanel(props: PropsWithChildren<Props>) {
  const { className, children } = props;

  const registry = useContext(MultiCanvasContext);
  assertNonNull(registry);
  const { linkKey } = useContext(VisPanelContext);

  const id = useId();
  const [scene] = useState(() => new Scene());
  const [camera] = useState(() => new ScaledOrthographicCamera());
  const ContextBridge = useContextBridge();
  const viewLink =
    linkKey === undefined ? undefined : registry.getViewLink(linkKey);

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();

  useLayoutEffect(() => {
    if (!root) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = root;
      setSize((prev) =>
        prev?.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  const internals = useMemo(
    () => root && { id, root, viewLink },
    [id, root, viewLink],
  );

  useLayoutEffect(() => {
    if (root && size && size.width > 0 && size.height > 0) {
      registry.set(id, {
        scene,
        camera,
        element: root,
        ...size,
        node: (
          <ContextBridge>
            <PanelInternalsContext value={internals}>
              {children}
            </PanelInternalsContext>
          </ContextBridge>
        ),
      });
    }
  });

  useLayoutEffect(() => () => registry.delete(id), [registry, id]);

  return (
    <div ref={setRoot} className={`${styles.panelRoot} ${className ?? ''}`}>
      <div className={styles.eventTarget} />
    </div>
  );
}

export default CanvasPanel;
