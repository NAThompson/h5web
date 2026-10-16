import { Canvas } from '@react-three/fiber';
import { FiberProvider } from 'its-fine';
import { type PropsWithChildren, useRef, useState } from 'react';

import { CanvasPanelRegistry, MultiCanvasContext } from './multi-canvas';
import styles from './MultiVisCanvas.module.css';
import PanelRenderer from './PanelRenderer';

interface Props {
  className?: string;
}

/**
 * Container of several visualizations (e.g. `HeatmapVis`, `LineVis`) drawn with a single WebGL
 * context: browsers limit their number (e.g. 16), so a canvas per visualization doesn't scale to
 * grids of panels. The children scroll over the shared canvas, which draws each visualization's
 * scene in its area (with its own camera, unless linked with `PanelLinkContext`), and only those
 * in view.
 */
function MultiVisCanvas(props: PropsWithChildren<Props>) {
  const { className = '', children } = props;

  const [registry] = useState(() => new CanvasPanelRegistry());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  return (
    <FiberProvider>
      <div className={`${styles.root} ${className}`}>
        <Canvas
          className={styles.canvas}
          flat // disable tone mapping
          frameloop="demand"
          dpr={[1, 3]}
          resize={{ debounce: { scroll: 20, resize: 200 }, scroll: false }}
          gl={{ preserveDrawingBuffer: true }} // for snapshots
          eventSource={scrollerRef}
        >
          <PanelRenderer registry={registry} scroller={scroller} />
        </Canvas>
        <div
          ref={(elem) => {
            scrollerRef.current = elem;
            setScroller(elem);
          }}
          className={styles.scroller}
          data-panel-scroller // cf. `SCROLLER_ATTR`
        >
          <MultiCanvasContext value={registry}>{children}</MultiCanvasContext>
        </div>
      </div>
    </FiberProvider>
  );
}

export type { Props as MultiVisCanvasProps };
export default MultiVisCanvas;
