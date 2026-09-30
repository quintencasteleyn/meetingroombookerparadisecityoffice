export default function Logo({ large = false }: { large?: boolean }) {
  const size = large ? 40 : 30
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--primary)" />
        <rect x="7" y="9" width="18" height="16" rx="3" fill="none" stroke="var(--primary-fg)" strokeWidth="2" />
        <path d="M7 14h18M12 6.5v4.5M20 6.5v4.5" stroke="var(--primary-fg)" strokeWidth="2" strokeLinecap="round" />
        <rect x="11" y="17" width="5" height="4" rx="1" fill="var(--primary-fg)" />
      </svg>
      <span className={`font-semibold tracking-tight text-fg ${large ? 'text-xl' : 'text-[15px]'}`}>
        Paradise City <span className="text-primary">Rooms</span>
      </span>
    </span>
  )
}
