import {
  ComplexVisTypeSelector,
  CurveType,
  DomainWidget,
  ExportMenu,
  Interpolation,
  Menu,
  RadioGroup,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import {
  AXIS_SCALE_TYPES,
  type ComplexLineVisType,
  ComplexVisType,
  type Domain,
  type ExportEntry,
} from '@h5web/shared/vis-models';
import {
  MdAutoGraph,
  MdEqualizer,
  MdGridOn,
  MdScatterPlot,
} from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { CURVE_TYPE_LABELS, INTERACTIONS_WITH_AXIAL_ZOOM } from '../utils';
import { type LineConfig } from './config';
import ErrorsIcon from './ErrorsIcon';
import { QQ_DISTRIBUTIONS } from './qq';

const COMPLEX_VIS_TYPES: ComplexLineVisType[] = [
  ComplexVisType.Amplitude,
  ComplexVisType.Phase,
  ComplexVisType.PhaseUnwrapped,
];

interface Props {
  dataDomain: Domain;
  isSlice?: boolean;
  isComplex?: boolean;
  withErrors?: boolean;
  config: LineConfig;
  exportEntries?: ExportEntry[];
  spectrum?: { value: boolean; onToggle: () => void; blocker?: string };
  qq?: { value: boolean; onToggle: () => void; blocker?: string };
}

function LineToolbar(props: Props) {
  const visArea = useVisArea();
  const {
    dataDomain,
    isSlice,
    isComplex,
    withErrors,
    config,
    exportEntries,
    spectrum,
    qq,
  } = props;

  const {
    customDomain,
    curveType,
    showGrid,
    xScaleType,
    yScaleType,
    complexVisType,
    showErrors,
    interpolation,
    setCustomDomain,
    setCurveType,
    setShowGrid,
    setXScaleType,
    setYScaleType,
    setComplexVisType,
    setShowErrors,
    setInterpolation,
  } = config;

  return (
    <Toolbar interactions={INTERACTIONS_WITH_AXIAL_ZOOM}>
      <DomainWidget
        dataDomain={dataDomain}
        customDomain={customDomain}
        scaleType={yScaleType}
        onCustomDomainChange={setCustomDomain}
      />
      <Separator />

      <ScaleSelector
        label="X"
        value={xScaleType}
        onScaleChange={setXScaleType}
        options={AXIS_SCALE_TYPES}
      />
      <ScaleSelector
        label="Y"
        value={yScaleType}
        onScaleChange={setYScaleType}
        options={AXIS_SCALE_TYPES}
      />

      {isComplex && (
        <>
          <Separator />
          <ComplexVisTypeSelector
            value={complexVisType}
            onChange={setComplexVisType}
            options={COMPLEX_VIS_TYPES}
          />
        </>
      )}

      <Separator />

      {withErrors && (
        <ToggleBtn
          label="Errors"
          Icon={ErrorsIcon}
          value={showErrors}
          onToggle={() => setShowErrors(!showErrors)}
        />
      )}

      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />

      {/* Q-Q plots draw their own points and lines */}
      {!qq?.value && (
        <Menu label="Aspect" Icon={MdAutoGraph}>
          <RadioGroup
            name="curvetype"
            value={curveType}
            options={Object.values(CurveType)}
            optionsLabels={CURVE_TYPE_LABELS}
            onChange={setCurveType}
          />
          <RadioGroup
            name="interpolation"
            label="Interpolation"
            options={Object.values(Interpolation)}
            disabled={curveType === CurveType.GlyphsOnly}
            value={interpolation}
            onChange={setInterpolation}
          />
        </Menu>
      )}

      {spectrum && (
        <ToggleBtn
          label="Spectrum"
          iconOnly
          Icon={MdEqualizer}
          value={spectrum.value}
          onToggle={spectrum.onToggle}
          disabled={!!spectrum.blocker}
          title={spectrum.blocker ?? 'Power spectrum'}
        />
      )}
      {qq && (
        <ToggleBtn
          label="Q-Q"
          iconOnly
          Icon={MdScatterPlot}
          value={qq.value}
          onToggle={qq.onToggle}
          disabled={!!qq.blocker}
          title={qq.blocker ?? 'Q-Q plot'}
        />
      )}
      {/* Also when blocked (lognormal of values ≤ 0), to pick another one */}
      {qq && config.showQQ && (
        <Menu label="Distribution">
          <RadioGroup
            name="qqdistribution"
            options={[...QQ_DISTRIBUTIONS]}
            value={config.qqDistribution}
            onChange={config.setQQDistribution}
          />
        </Menu>
      )}

      <Separator />

      {exportEntries && exportEntries.length > 0 && (
        <ExportMenu isSlice={isSlice} entries={exportEntries} />
      )}

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default LineToolbar;
