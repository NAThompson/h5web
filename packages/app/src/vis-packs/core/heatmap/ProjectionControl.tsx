import { Selector } from '@h5web/lib';

import { type Projection } from '../../view-hints/models';
import { PROJECTIONS } from './projection';

const NONE = 'none';
const LABELS: Record<Projection | typeof NONE, string> = {
  none: 'None',
  max: 'Max',
  min: 'Min',
  mean: 'Mean',
  sum: 'Sum',
};

interface Props {
  value: Projection | undefined; // `undefined`: slices
  dim: number | undefined; // dimension reduced
  dims: { dim: number; label: string }[]; // sliced dimensions, which can be reduced
  onChange: (value: Projection | undefined) => void;
  onDimChange: (dim: number) => void;
}

/* Reduce a sliced dimension of a stack (e.g. maximum intensity projection) instead of slicing it */
function ProjectionControl(props: Props) {
  const { value, dim, dims, onChange, onDimChange } = props;

  return (
    <>
      <Selector
        label="Projection"
        value={value ?? NONE}
        onChange={(val) => onChange(val === NONE ? undefined : val)}
        options={[NONE, ...PROJECTIONS]}
        renderOption={(option) => LABELS[option]}
      />
      {value && dims.length > 1 && dim !== undefined && (
        <Selector
          label="over"
          value={String(dim)}
          onChange={(val) => onDimChange(Number(val))}
          options={dims.map((d) => String(d.dim))}
          renderOption={(option) =>
            dims.find((d) => String(d.dim) === option)?.label
          }
        />
      )}
    </>
  );
}

export type { Props as ProjectionControlProps };
export default ProjectionControl;
