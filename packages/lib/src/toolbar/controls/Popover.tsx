import { useClick, useInteractions } from '@floating-ui/react';
import { type ComponentType, type PropsWithChildren, useId } from 'react';

import Btn from './Btn';
import { useFloatingDismiss, useFloatingMenu } from './hooks';
import styles from './Popover.module.css';

interface Props {
  label: string;
  Icon?: ComponentType<{ className: string }>;
  /* Text of the toggle button, if different from `label` (used as the dialog's accessible name) */
  btnLabel?: string;
  iconOnly?: boolean;
}

/* Toolbar button toggling a non-modal panel of arbitrary controls */
function Popover(props: PropsWithChildren<Props>) {
  const { label, Icon, btnLabel = label, iconOnly, children } = props;

  const { context, refs, floatingStyles } = useFloatingMenu();
  const { floatingId, open: isOpen } = context;

  const referenceId = useId();

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useFloatingDismiss(context),
  ]);

  return (
    <>
      <Btn
        ref={refs.setReference}
        id={referenceId}
        label={iconOnly ? label : btnLabel}
        aria-label={label}
        Icon={Icon}
        iconOnly={iconOnly}
        withArrow
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={(isOpen && floatingId) || undefined}
        {...getReferenceProps()}
      />

      {isOpen && (
        <div
          ref={refs.setFloating}
          id={floatingId}
          className={styles.popover}
          style={floatingStyles}
          role="dialog"
          aria-label={label}
          {...getFloatingProps()}
        >
          {children}
        </div>
      )}
    </>
  );
}

export type { Props as PopoverProps };
export default Popover;
