import { useCallback, useRef, useState } from 'react';

const MAX_HISTORY_DEPTH = 50;

export default function useProjectHistory({ onApplySnapshot }) {
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const push = useCallback((entry) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY_DEPTH - 1)),
      entry,
    ];
    redoStackRef.current = [];
    bump();
  }, [bump]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) {
      return false;
    }
    const entry = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, entry];
    bump();
    if (onApplySnapshot) {
      onApplySnapshot(entry.undoSnapshot);
    }
    return true;
  }, [onApplySnapshot, bump]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) {
      return false;
    }
    const entry = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, entry];
    bump();
    if (onApplySnapshot) {
      onApplySnapshot(entry.redoSnapshot);
    }
    return true;
  }, [onApplySnapshot, bump]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    bump();
  }, [bump]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    undoCount: undoStackRef.current.length,
    redoCount: redoStackRef.current.length,
    version,
  };
};
