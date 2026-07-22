import type { SVGProps } from 'react'

type FileLogoProps = SVGProps<SVGSVGElement> & { weight?: string }

/** Compact, brand-colour file marks that remain legible at attachment-card size. */
export function PdfFileLogo({ className, weight: _weight, ...props }: FileLogoProps) {
  return (
    <svg
      viewBox="4 1 32 38"
      fill="none"
      className={className}
      data-file-logo="pdf"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 2.5h17.2L33 11.3v26.2H7V2.5Z" fill="#E5252A" />
      <path d="M24.2 2.5v8.8H33" fill="#B51D26" />
      <path d="M24.2 2.5v8.8H33" stroke="#fff" strokeOpacity=".22" strokeWidth="1.2" />
      <path
        d="M12 27.8c2.1-3.4 3.7-6.6 4.7-9.8.8-2.7 1.1-4.8.7-6.1-.2-.7-.7-1.1-1.3-1.1-.8 0-1.1.9-.8 2.7.4 2.4 2.3 5.8 5.3 8.3 2.9 2.4 5.9 3.5 8.1 3.4 1.1-.1 1.7-.6 1.7-1.4 0-.7-.8-1.1-2.3-1.1-2.8.1-6.3 1-9.3 2.5-3.1 1.5-5.8 3.4-7.3 5.2"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M10 31.5h20" stroke="#fff" strokeOpacity=".42" strokeWidth="1" />
    </svg>
  )
}

export function WordFileLogo({ className, weight: _weight, ...props }: FileLogoProps) {
  return (
    <svg
      viewBox="4 1 32 38"
      fill="none"
      className={className}
      data-file-logo="word"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 2.5h17.2L33 11.3v26.2H7V2.5Z" fill="#185ABD" />
      <path d="M24.2 2.5v8.8H33" fill="#0F4A9A" />
      <path d="M24.2 2.5v8.8H33" stroke="#fff" strokeOpacity=".2" strokeWidth="1.2" />
      <path
        d="m11.3 15 2.2 10.2 2.2-7.1 2.2 7.1L20 15"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M10 30h20M10 33h14" stroke="#fff" strokeOpacity=".42" strokeWidth="1" />
    </svg>
  )
}

export function ExcelFileLogo({ className, weight: _weight, ...props }: FileLogoProps) {
  return (
    <svg
      viewBox="4 1 32 38"
      fill="none"
      className={className}
      data-file-logo="excel"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 2.5h17.2L33 11.3v26.2H7V2.5Z" fill="#217346" />
      <path d="M24.2 2.5v8.8H33" fill="#185C37" />
      <path d="M24.2 2.5v8.8H33" stroke="#fff" strokeOpacity=".2" strokeWidth="1.2" />
      <path
        d="m11.4 16 3.4 5.9-3.4 5.9M18.8 16l-3.4 5.9 3.4 5.9"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M10 31h20M10 34h14" stroke="#fff" strokeOpacity=".42" strokeWidth="1" />
    </svg>
  )
}
