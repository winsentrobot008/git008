/**
 * World3DGlyph - the icon for the AI 3D Immersive Space surface.
 *
 * An inline SVG rather than a `lucide-react` import: the card grid mixes it with
 * lucide icons behind one prop type, and owning the shape here keeps the 3D
 * feature from depending on an icon name existing in whatever lucide version this
 * app resolves to.
 */

export default function World3DGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Isometric volume: the outline of a reconstructed space. */}
      <path d="M12 2.8 20.4 7.5v9L12 21.2 3.6 16.5v-9L12 2.8Z" />
      <path d="M12 12 20.4 7.5M12 12v9.2M12 12 3.6 7.5" />
      <circle cx="12" cy="6.6" r="1.5" />
    </svg>
  );
}