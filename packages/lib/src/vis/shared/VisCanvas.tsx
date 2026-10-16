import {
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useState,
} from 'react';

import InteractionsProvider from '../../interactions/InteractionsProvider';
import { type Aspect, type AxisConfig } from '../models';
import { getAxisOffsets, getVisRatio } from '../utils';
import AxisSystem from './AxisSystem';
import CanvasPanel from './CanvasPanel';
import {
  MultiCanvasContext,
  VisPanelContext,
  withoutHiddenAxes,
} from './multi-canvas';
import PanelViewLink from './PanelViewLink';
import R3FCanvas from './R3FCanvas';
import RatioEnforcer from './RatioEnforcer';
import ThresholdAdjuster from './ThresholdAdjuster';
import ViewportCenterer from './ViewportCenterer';
import styles from './VisCanvas.module.css';
import VisCanvasProvider from './VisCanvasProvider';

const NO_OFFSETS = { left: 0, right: 0, top: 0, bottom: 0 };

interface Props {
  title?: ReactNode;
  aspect?: Aspect;
  abscissaConfig: AxisConfig;
  ordinateConfig: AxisConfig;
  raycasterThreshold?: number;
  showAxes?: boolean;
}

function VisCanvas(props: PropsWithChildren<Props>) {
  const {
    title,
    aspect = 'auto',
    abscissaConfig,
    ordinateConfig,
    raycasterThreshold,
    showAxes = true,
    children,
  } = props;

  // Within a `MultiVisCanvas`, drawn in its shared canvas, maybe without some axes
  const isPanel = !!useContext(MultiCanvasContext);
  const { axes } = useContext(VisPanelContext);
  const Canvas = isPanel ? CanvasPanel : R3FCanvas;

  const visRatio = getVisRatio(
    aspect,
    abscissaConfig.visDomain,
    ordinateConfig.visDomain,
  );

  const axisOffsets = showAxes
    ? withoutHiddenAxes(
        getAxisOffsets({
          left: !!ordinateConfig.label,
          bottom: !!abscissaConfig.label,
          top: !!title,
        }),
        axes,
      )
    : NO_OFFSETS;

  const [svgOverlay, setSvgOverlay] = useState<SVGSVGElement | null>(null);
  const [floatingToolbar, setFloatingToolbar] = useState<HTMLDivElement | null>(
    null,
  );

  return (
    <div
      className={styles.visCanvas}
      style={{
        gridTemplateColumns: `${axisOffsets.left}px minmax(0, 1fr) ${axisOffsets.right}px`,
        gridTemplateRows: `${axisOffsets.top}px minmax(0, 1fr) ${axisOffsets.bottom}px`,
      }}
    >
      {showAxes && title && <p className={styles.title}>{title}</p>}

      <div className={styles.canvasArea}>
        <Canvas className={styles.r3fRoot} orthographic>
          <VisCanvasProvider
            visRatio={visRatio}
            abscissaConfig={abscissaConfig}
            ordinateConfig={ordinateConfig}
            svgOverlay={svgOverlay}
            floatingToolbar={floatingToolbar}
          >
            <AxisSystem
              axisOffsets={axisOffsets}
              showAxes={showAxes}
              axes={axes}
            />
            <InteractionsProvider>{children}</InteractionsProvider>
            <ViewportCenterer />
            {isPanel && <PanelViewLink />}
            <RatioEnforcer />
            {raycasterThreshold !== undefined && (
              <ThresholdAdjuster value={raycasterThreshold} />
            )}
          </VisCanvasProvider>
        </Canvas>

        <svg
          ref={setSvgOverlay}
          className={styles.svgOverlay}
          overflow="hidden"
        />
      </div>

      <div
        ref={setFloatingToolbar}
        className={styles.floatingToolbar}
        data-snapshot-ignore
      />
    </div>
  );
}

export type { Props as VisCanvasProps };
export default VisCanvas;
