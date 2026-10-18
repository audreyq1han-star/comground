export function Sunrise({ large = false }: { large?: boolean }) {
  return <svg className={large ? 'sunrise sunrise-large' : 'sunrise'} viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="26" fill="#0284c7" />
    <path d="M14 58 A36 36 0 0 1 86 58Z" fill="#fb923c" />
    <path d="M24 58 A26 26 0 0 1 76 58Z" fill="#fdba74" />
    <path d="M34 58 A16 16 0 0 1 66 58Z" fill="#fde68a" />
    <circle cx="50" cy="58" r="8" fill="white" />
    <path d="M14 58 A36 36 0 0 0 86 58Z" fill="#06c4b0" opacity=".5" />
    <path d="M24 58 A26 26 0 0 0 76 58Z" fill="#06c4b0" opacity=".3" />
    <path d="M34 58 A16 16 0 0 0 66 58Z" fill="#06c4b0" opacity=".2" />
    <path d="M50 32V18M72 40L78 30M28 40L22 30" stroke="#fde68a" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M12 71H88M12 82H88" stroke="#06c4b0" opacity=".4" />
  </svg>;
}
