import { useCallback, useEffect } from 'react';

export function useConfirmDirtyClose({
  isDirty,
  onClose,
  enabled = true,
  message = 'You have unsaved changes. Close anyway?',
}) {
  const requestClose = useCallback(() => {
    if (!onClose) return;
    if (isDirty && !window.confirm(message)) return;
    onClose();
  }, [isDirty, onClose, message]);

  useEffect(() => {
    if (!enabled || !onClose) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, onClose, requestClose]);

  return requestClose;
}
