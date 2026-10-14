import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { type ElementType, type PropsWithChildren } from 'react';
import { type IconType } from 'react-icons';

export interface VisContainerProps {
  entity: ProvidedEntity;
  toolbarContainer: HTMLDivElement | undefined;
}

export interface VisDef {
  name: string;
  Icon: IconType;
  Container: ElementType<VisContainerProps>;
  ConfigProvider?: ElementType<PropsWithChildren>;
  /* Never remembered as the preferred vis: selecting it once must not open other datasets with it
   * (e.g. volumes, which load whole datasets and are only a reasonable default for some of them) */
  isNeverPreferred?: boolean;
}
