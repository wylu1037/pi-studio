'use client'

import { useLayoutEffect, useState } from 'react'

/**
 * Returns the width occupied by the desktop sidebar gap while an overlay is
 * active. Mobile sidebars are rendered as a sheet, so they do not offset the
 * overlay viewport.
 */
export function useSidebarOffset(active: boolean) {
  const [offset, setOffset] = useState(0)

  useLayoutEffect(() => {
    if (!active) {
      setOffset(0)
      return
    }

    const sidebarGap = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]')
    if (!sidebarGap) {
      setOffset(0)
      return
    }

    const updateOffset = () => setOffset(sidebarGap.getBoundingClientRect().width)
    updateOffset()

    const resizeObserver = new ResizeObserver(updateOffset)
    resizeObserver.observe(sidebarGap)
    window.addEventListener('resize', updateOffset)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateOffset)
    }
  }, [active])

  return offset
}
