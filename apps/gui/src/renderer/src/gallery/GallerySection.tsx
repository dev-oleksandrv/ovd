import type { ReactNode } from 'react'

interface GallerySectionProps {
  title: string
  children: ReactNode
}

export function GallerySection({ title, children }: GallerySectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-label font-normal tracking-[.06em] text-subtle uppercase">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}
