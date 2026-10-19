import {
  ColorMapSelector,
  CurveType,
  type Domain,
  DomainWidget,
  Menu,
  RadioGroup,
  ResetViewBtn,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import { MdAspectRatio, MdAutoGraph, MdGridOn } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { CURVE_TYPE_LABELS, SURFACE_INTERACTIONS } from '../utils';
import { type CurveConfig, LINE_WIDTH_PX, LineWidth } from './config';

const LINE_WIDTH_LABELS = Object.fromEntries(
  Object.entries(LINE_WIDTH_PX).map(([width, px]) => [width, `${px} px`]),
) as Record<LineWidth, string>;

interface Props {
  dataDomain: Domain;
  config: CurveConfig;
}

function CurveToolbar(props: Props) {
  const visArea = useVisArea();
  const { dataDomain, config } = props;
  const {
    customDomain,
    colorMap,
    invertColorMap,
    scaleType,
    keepRatio,
    showGrid,
    curveType,
    lineWidth,
    setCustomDomain,
    setColorMap,
    setInvertColorMap,
    setScaleType,
    setKeepRatio,
    setShowGrid,
    setCurveType,
    setLineWidth,
  } = config;

  return (
    <Toolbar interactions={SURFACE_INTERACTIONS}>
      <DomainWidget
        dataDomain={dataDomain}
        customDomain={customDomain}
        scaleType={scaleType}
        onCustomDomainChange={setCustomDomain}
      />
      <Separator />

      <ColorMapSelector
        value={colorMap}
        onValueChange={setColorMap}
        invert={invertColorMap}
        onInversionChange={() => setInvertColorMap(!invertColorMap)}
      />
      <Separator />

      <ScaleSelector
        value={scaleType}
        onScaleChange={setScaleType}
        options={COLOR_SCALE_TYPES}
      />
      <Separator />

      <ToggleBtn
        label="Keep ratio"
        Icon={MdAspectRatio}
        value={keepRatio}
        onToggle={() => setKeepRatio(!keepRatio)}
      />
      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />

      <Menu label="Aspect" Icon={MdAutoGraph}>
        <RadioGroup
          name="curvetype"
          value={curveType}
          options={Object.values(CurveType)}
          optionsLabels={CURVE_TYPE_LABELS}
          onChange={setCurveType}
        />
        <RadioGroup
          name="linewidth"
          label="Line width"
          options={Object.values(LineWidth)}
          optionsLabels={LINE_WIDTH_LABELS}
          disabled={curveType === CurveType.GlyphsOnly}
          value={lineWidth}
          onChange={setLineWidth}
        />
      </Menu>
      <Separator />

      <ResetViewBtn target={visArea} />
      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default CurveToolbar;
