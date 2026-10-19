import {
  Separator,
  SnapshotBtn,
  ToggleBtn,
  ToggleGroup,
  Toolbar,
} from '@h5web/lib';
import { assertGroup } from '@h5web/shared/guards';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MdGridOn } from 'react-icons/md';
import { TbDivide, TbSum } from 'react-icons/tb';

import { useVisArea } from '../../visualizer/vis-area';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { type VisContainerProps } from '../models';
import VisBoundary from '../VisBoundary';
import NurbsBasisFetcher from './NurbsBasisFetcher';
import NurbsSurfaceBasisFetcher from './NurbsSurfaceBasisFetcher';
import { isNurbsSurfaceGroup } from './utils';

/* Basis functions of a NURBS curve or surface (along `u` or `v`) over the knot domain */
function NurbsBasisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  const isSurface = isNurbsSurfaceGroup(entity);
  const hasWeights = entity.children.some(({ name }) => name === 'weights');

  const visArea = useVisArea();
  const [param, setParam] = useState<'u' | 'v'>('u');
  const [rational, setRational] = useState(true);
  const [showSum, setShowSum] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  const plotProps = {
    group: entity,
    className: visualizerStyles.vis,
    showSum,
    showGrid,
  };
  return (
    <>
      {toolbarContainer &&
        createPortal(
          <Toolbar>
            {isSurface && (
              <>
                <ToggleGroup
                  role="radiogroup"
                  ariaLabel="Parameter"
                  value={param}
                  onChange={(val) => setParam(val as 'u' | 'v')}
                >
                  <ToggleGroup.Btn label="𝑢" value="u" />
                  <ToggleGroup.Btn label="𝑣" value="v" />
                </ToggleGroup>
                <Separator />
              </>
            )}
            {!isSurface && hasWeights && (
              <ToggleBtn
                label="Rational"
                Icon={TbDivide}
                value={rational}
                onToggle={() => setRational(!rational)}
              />
            )}
            <ToggleBtn
              label="Sum"
              Icon={TbSum}
              value={showSum}
              onToggle={() => setShowSum(!showSum)}
            />
            <ToggleBtn
              label="Grid"
              Icon={MdGridOn}
              value={showGrid}
              onToggle={() => setShowGrid(!showGrid)}
            />
            <Separator />
            <SnapshotBtn target={visArea} />
          </Toolbar>,
          toolbarContainer,
        )}

      <VisBoundary>
        {isSurface ? (
          <NurbsSurfaceBasisFetcher param={param} {...plotProps} />
        ) : (
          <NurbsBasisFetcher rational={rational} {...plotProps} />
        )}
      </VisBoundary>
    </>
  );
}

export default NurbsBasisContainer;
