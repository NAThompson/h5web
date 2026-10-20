import {
  ColorMapSelector,
  ComplexVisTypeSelector,
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
import { COLOR_SCALE_TYPES, ComplexVisType } from '@h5web/shared/vis-models';
import { MdAspectRatio, MdAutoGraph, MdGridOn } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { LINE_WIDTH_PX, LineWidth } from '../geometry/config';
import { CURVE_TYPE_LABELS, SURFACE_INTERACTIONS } from '../utils';
import {
  type ComplexCurveColorType,
  type ComplexCurveConfig,
} from './curve-config';

const COLOR_TYPES: ComplexCurveColorType[] = [
  ComplexVisType.Phase,
  ComplexVisType.Amplitude,
];

const LINE_WIDTH_LABELS = Object.fromEntries(
  Object.entries(LINE_WIDTH_PX).map(([width, px]) => [width, `${px} px`]),
) as Record<LineWidth, string>;

interface Props {
  amplitudeDomain: Domain;
  config: ComplexCurveConfig;
}

function ComplexCurveToolbar(props: Props) {
  const visArea = useVisArea();
  const { amplitudeDomain, config } = props;
  const {
    customDomain,
    colorMap,
    invertColorMap,
    scaleType,
    keepRatio,
    showGrid,
    curveType,
    lineWidth,
    colorBy,
    phaseColorMap,
    setCustomDomain,
    setColorMap,
    setInvertColorMap,
    setScaleType,
    setKeepRatio,
    setShowGrid,
    setCurveType,
    setLineWidth,
    setColorBy,
    setPhaseColorMap,
  } = config;

  const byPhase = colorBy === ComplexVisType.Phase;

  return (
    <Toolbar interactions={SURFACE_INTERACTIONS}>
      <ComplexVisTypeSelector
        label="Color"
        value={colorBy}
        onChange={setColorBy}
        options={COLOR_TYPES}
      />
      <Separator />

      {/* Phase is always mapped linearly over [-π, π], so domain and scale only apply to amplitude */}
      {!byPhase && (
        <>
          <DomainWidget
            dataDomain={amplitudeDomain}
            customDomain={customDomain}
            scaleType={scaleType}
            onCustomDomainChange={setCustomDomain}
          />
          <Separator />
        </>
      )}

      <ColorMapSelector
        value={byPhase ? phaseColorMap : colorMap}
        onValueChange={byPhase ? setPhaseColorMap : setColorMap}
        invert={invertColorMap}
        onInversionChange={() => setInvertColorMap(!invertColorMap)}
      />
      <Separator />

      {!byPhase && (
        <>
          <ScaleSelector
            value={scaleType}
            onScaleChange={setScaleType}
            options={COLOR_SCALE_TYPES}
          />
          <Separator />
        </>
      )}

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

export default ComplexCurveToolbar;
