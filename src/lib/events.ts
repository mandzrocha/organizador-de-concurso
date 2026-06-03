'use client'

import { useEffect } from 'react'

/**
 * Mini event-bus para avisar páginas que os dados mudaram a partir de uma ação
 * GLOBAL (ex.: QuickLog disparado pelo FAB que vive no layout, fora da página).
 * Sem isso, registrar um estudo pelo FAB não atualizaria a tela atual.
 */
const DATA_CHANGED = 'editalfocus:data-changed'

export function emitDataChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DATA_CHANGED))
  }
}

export function useDataChanged(callback: () => void) {
  useEffect(() => {
    function handler() { callback() }
    window.addEventListener(DATA_CHANGED, handler)
    return () => window.removeEventListener(DATA_CHANGED, handler)
  }, [callback])
}
