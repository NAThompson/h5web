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
  /* Whether selecting this vis for the entity may make it the preferred vis (restored for other
   * entities), and whether a preferred vis of this name applies to the entity; defaults to true */
  canBePreferredFor?: (entity: ProvidedEntity) => boolean;
}
