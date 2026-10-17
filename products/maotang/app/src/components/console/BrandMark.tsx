/**
 * The two inline marks the C-end surfaces share.
 *
 * They are drawn rather than imported so the bundle carries no icon font, and so both marks inherit the
 * rose console palette at any size. Keeping them here also gives the policy suite one stable place to
 * assert the M contour instead of tying the check to whichever panel happens to render it today.
 */

export function BrandMark({ className = "h-9 w-9" }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 23.5V10.5l9 8.5 9-8.5v13" />
      <path d="M7 10.5 8.4 4.8 12.6 8" />
      <path d="M25 10.5 23.6 4.8 19.4 8" />
      <path d="M4 16.6h3.2" />
      <path d="M24.8 16.6H28" />
    </svg>
  );
}

export function FingerprintMark({ className = "h-5 w-5" }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M12 3.9A8.6 8.6 0 0 0 5 6.9" />
      <path d="M19 6.9a8.6 8.6 0 0 0-4-2.7" />
      <path d="M6.3 9A8.3 8.3 0 0 0 4.3 14c0 1 .1 1.9.4 2.8" />
      <path d="M19.7 14a8.2 8.2 0 0 0-1.4-4.6" />
      <path d="M12 8.7A5.3 5.3 0 0 0 6.7 14c0 1.5.3 2.9.9 4.1" />
      <path d="M17.3 14c0-2.9-2.4-5.3-5.3-5.3" />
      <path d="M12 13.3c-.5.1-.8.5-.8 1 0 1.4.3 2.6.7 3.8" />
    </svg>
  );
}
