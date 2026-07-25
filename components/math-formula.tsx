import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

import { cn } from '@/lib/utils'

// Renders a LaTeX expression with KaTeX. `throwOnError: false` keeps a
// malformed formula from crashing the message — KaTeX emits the source in a
// red error span instead, which is the friendliest failure for chat content.
export const MathFormula = memo(function MathFormula({
  tex,
  display = false,
  className,
}: {
  tex: string
  display?: boolean
  className?: string
}) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      }),
    [tex, display],
  )

  const Tag = display ? 'div' : 'span'
  return (
    <Tag
      // KaTeX output is generated from the TeX source by our own trusted
      // library call, not user-authored HTML, so injecting it is safe here.
      dangerouslySetInnerHTML={{ __html: html }}
      className={cn(
        display ? 'my-2 block overflow-x-auto text-center' : 'inline-block align-middle',
        className,
      )}
    />
  )
})
