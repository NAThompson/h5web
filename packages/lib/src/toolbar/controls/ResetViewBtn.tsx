import { MdCenterFocusStrong } from 'react-icons/md';

import { findVisElement } from '../../vis/snapshot/render';
import { RESET_VIEW_EVENT } from '../../vis/three-d/utils';
import Btn from './Btn';

type Target = HTMLElement | null | undefined;

interface Props {
  /* Container of the 3D visualizations to reset (all of them, e.g. panels), as for
   * `SnapshotBtn`. Defaults to the visualization found by walking up the DOM from the button. */
  target?: Target | (() => Target);
}

/* Look at the scene from the default angle again: sends `RESET_VIEW_EVENT` to the canvases */
function ResetViewBtn(props: Props) {
  const { target } = props;

  return (
    <Btn
      label="Reset view"
      Icon={MdCenterFocusStrong}
      onClick={(evt) => {
        const container = typeof target === 'function' ? target() : target;
        const root = container ?? findVisElement(evt.currentTarget);
        for (const canvas of root?.querySelectorAll('canvas') ?? []) {
          canvas.dispatchEvent(new Event(RESET_VIEW_EVENT));
        }
      }}
    />
  );
}

export type { Props as ResetViewBtnProps };
export default ResetViewBtn;
