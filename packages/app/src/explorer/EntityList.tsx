import { assertGroup } from '@h5web/shared/guards';
import { buildEntityPath } from '@h5web/shared/hdf5-utils';
import { useQuery } from '@tanstack/react-query';

import { useEntity } from '../hooks';
import { useDataContext } from '../providers/DataProvider';
import EntityItem from './EntityItem'; // eslint-disable-line import-x/no-cycle -- recusive components
import styles from './Explorer.module.css';
import { auxRolesQuery } from './utils';

interface Props {
  level: number;
  parentPath: string;
  selectedPath: string;
  onSelect: (path: string) => void;
}

function EntityList(props: Props) {
  const { level, parentPath, selectedPath, onSelect } = props;

  const group = useEntity(parentPath);
  assertGroup(group);

  // Not suspended: rows are listed first, auxiliary data is muted once known
  const { data: auxRoles } = useQuery(auxRolesQuery(group, useDataContext()));

  if (group.children.length === 0) {
    return null;
  }

  return (
    <ul className={styles.group} role="group">
      {group.children.map((entity) => {
        const { name } = entity;

        return (
          <EntityItem
            key={name}
            path={buildEntityPath(parentPath, name)}
            entity={entity}
            auxRole={auxRoles?.get(name)}
            level={level}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        );
      })}
    </ul>
  );
}

export default EntityList;
