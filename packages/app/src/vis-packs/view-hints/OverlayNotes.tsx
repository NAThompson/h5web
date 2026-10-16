import { createContext, useContext } from 'react';

import styles from './ViewHints.module.css';

interface Props {
  notes: string[];
}

/* Notes about the entity rather than the vis (e.g. hinted vis not available), shown by every vis
 * that shows notes */
export const EntityNotesContext = createContext<string[]>([]);

/* What parts of a `H5WEB_*` view hint can't be applied (e.g. overlays that failed to resolve),
 * collapsed into a chip in a corner of the plot so as not to cover it */
function OverlayNotes(props: Props) {
  const { notes: visNotes } = props;
  const notes = [...useContext(EntityNotesContext), ...visNotes];
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className={styles.notes} role="note" aria-label="View hint notes">
      <details>
        <summary>
          ⓘ {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </summary>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </details>
    </div>
  );
}

export default OverlayNotes;
