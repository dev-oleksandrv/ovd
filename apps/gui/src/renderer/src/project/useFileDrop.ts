import { useEffect, useState } from 'react'

// Files dropped anywhere in the window. Returns whether a file is being dragged over it, for
// the project card's "Drop to open" state. Also keeps Electron from navigating to the file.
export function useFileDrop(onDrop: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter and dragleave fire for every child element; count them to know when the
    // drag leaves the window.
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const enter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const over = (event: DragEvent): void => {
      if (hasFiles(event)) event.preventDefault()
    }
    const leave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const file = event.dataTransfer?.files[0]
      if (file) onDrop(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onDrop])

  return dragging
}
