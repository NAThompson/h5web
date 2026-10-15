import { createContext, useContext } from 'react';

import styles from './ViewHints.module.css';

interface Props {
  notes: string[];
}

/* Notes about the entity rather than the vis (e.g. hinted vis not available), shown by every vis
 * that shows notes */
export const EntityNotesContext = createContext<string[]>([]);

/* What parts of a `H5WEB_*` view hint can't be applied (e.g. overlays that failed to resolve) */
function OverlayNotes(props: Props) {
  const { notes: visNotes } = props;
  const notes = [...useContext(EntityNotesContext), ...visNotes];
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className={styles.notes} role="note" aria-label="View hint notes">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

export default OverlayNotes;
