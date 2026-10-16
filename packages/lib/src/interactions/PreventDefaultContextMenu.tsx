import { useEventListener } from '@react-hookz/web';
import { useThree } from '@react-three/fiber';
import { useContext } from 'react';

import { IS_MAC } from '../toolbar/utils';
import { PanelInternalsContext } from '../vis/shared/multi-canvas';
import { useInteractionsContext } from './InteractionsProvider';
import { MouseButton } from './models';

interface Props {
  when?: 'as-needed' | 'always' | 'never';
}

function PreventDefaultContextMenu(props: Props) {
  const { when = 'as-needed' } = props;
  const { getInteractions } = useInteractionsContext();

  const { domElement } = useThree((state) => state.gl);
  const panel = useContext(PanelInternalsContext); // the shared canvas gets no events
  const target = panel?.root ?? domElement;

  useEventListener(target, 'contextmenu', (evt: PointerEvent) => {
    if (
      when === 'always' ||
      (when === 'as-needed' &&
        (getInteractions(MouseButton.Right).length > 0 ||
          (IS_MAC && getInteractions(MouseButton.Left, 'Control').length > 0))) // Ctrl+left click triggers context menu on MacOS
    ) {
      evt.preventDefault();
    }
  });

  return null;
}

export { type Props as PreventDefaultContextMenuProps };
export default PreventDefaultContextMenu;
