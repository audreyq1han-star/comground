/** Sunrise and reflection from the original CommonGround brand guide. */
export function Brand({ large = false, className = '' }: { large?: boolean; className?: string }) {
  return <span className={`wordmark ${large ? 'wordmark-large' : ''} ${className}`}>
    <svg viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <rect width="56" height="56" rx="14" fill="#0284c7" />
      <path d="M8 33a20 20 0 0 1 40 0Z" fill="#fb923c" />
      <path d="M15 33a13 13 0 0 1 26 0Z" fill="#fdba74" />
      <path d="M22 33a6 6 0 0 1 12 0Z" fill="#fff3c4" />
      <path d="M8 33a20 20 0 0 0 40 0Z" fill="#06c4b0" opacity=".5" />
      <path d="M15 33a13 13 0 0 0 26 0Z" fill="#06c4b0" opacity=".4" />
      <path d="M7 33h42M13 42h30" stroke="#a4d8ef" strokeWidth="1.25" opacity=".65" />
      <path d="M28 11v7m-12 5-4-6m28 6 4-6" stroke="#fde68a" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
    <span>Common<span className="brand-ground">Ground</span></span>
  </span>;
}
