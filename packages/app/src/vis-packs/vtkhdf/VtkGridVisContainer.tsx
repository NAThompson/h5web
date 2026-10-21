import { getDefaultResolution, Selector } from '@h5web/lib';
import { assertGroup, assertGroupWithChildren } from '@h5web/shared/guards';
import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import LargeValueGuard from '../LargeValueGuard';
import { type VisContainerProps } from '../models';
import OverlayNotes from '../view-hints/OverlayNotes';
import VisBoundary from '../VisBoundary';
import { useVtkGridInfo, useVtkSelection } from './hooks';
import ResampledFetcher from './ResampledFetcher';
import {
  getDefaultField,
  getMeshDatasets,
  type ResampledField,
  type VtkField,
} from './utils';
import styles from './VtkToolbar.module.css';

const RESOLUTIONS = ['auto', '64', '128', '192', '256']; // samples along the longest side

interface Props extends VisContainerProps {
  render: (field: VtkField, resampled: ResampledField) => ReactElement;
}

/* Field of a VTKHDF `UnstructuredGrid`, resampled onto a regular grid (NaN outside the mesh)
 * and shown as a volume or orthoslices */
function VtkGridVisContainer(props: Props) {
  const { entity, toolbarContainer, render } = props;
  assertGroup(entity);
  assertGroupWithChildren(entity);

  const info = useVtkGridInfo(entity);
  const { fields, nSteps, cellCount } = info;
  const [selection, select] = useVtkSelection(entity);
  const field =
    fields.find(({ dataset }) => dataset.path === selection.fieldPath) ??
    getDefaultField(fields);
  if (!field) {
    throw new Error('Expected numeric arrays in PointData or CellData');
  }

  const autoResolution = getDefaultResolution(cellCount);
  const resolution = selection.resolution ?? autoResolution;

  const notes = [
    ...(field.components > 1
      ? [
          `${field.dataset.name} has ${field.components} components: shown by magnitude`,
        ]
      : []),
    ...(nSteps ? [`First of ${nSteps} time steps`] : []),
  ];

  const fieldOptions = Object.fromEntries(
    [
      ['Point data', getPaths(fields, 'point')],
      ['Cell data', getPaths(fields, 'cell')],
    ].filter(([, paths]) => paths.length > 0),
  );

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <div className={styles.wrapper}>
            <Selector
              label="Field"
              value={field.dataset.path}
              onChange={(fieldPath) => select({ fieldPath })}
              options={fieldOptions}
              renderOption={(path) => path.slice(path.lastIndexOf('/') + 1)}
            />
            <Selector
              label="Resolution"
              value={selection.resolution ? String(resolution) : 'auto'}
              onChange={(val) =>
                select({ resolution: val === 'auto' ? undefined : Number(val) })
              }
              options={RESOLUTIONS}
              renderOption={(val) =>
                val === 'auto' ? `auto (${autoResolution})` : val
              }
            />
          </div>,
          toolbarContainer,
        )}
      <VisBoundary resetKey={`${field.dataset.path}-${resolution}`}>
        <LargeValueGuard
          requests={[...Object.values(getMeshDatasets(entity)), field.dataset]
            .filter(({ name }) => !name.startsWith('NumberOf')) // already fetched
            .map((dataset) => ({ dataset }))}
        >
          <ResampledFetcher
            key={resolution} // new grid: e.g. new crosshair of orthoslices
            group={entity}
            info={info}
            field={field}
            resolution={resolution}
            render={(resampled) => render(field, resampled)}
          />
        </LargeValueGuard>
      </VisBoundary>
      <OverlayNotes notes={notes} />
    </>
  );
}

function getPaths(fields: VtkField[], association: VtkField['association']) {
  return fields
    .filter((field) => field.association === association)
    .map(({ dataset }) => dataset.path);
}

export default VtkGridVisContainer;
