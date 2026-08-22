type NoosphereMarkProps = {
  readonly className?: string;
  readonly title?: string;
};

export function NoosphereMark({ className = "", title }: NoosphereMarkProps) {
  return (
    <span
      aria-label={title}
      className={`noosphere-mark ${className}`}
      role={title ? "img" : undefined}
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 48 48">
        <path d="M13 35V13L35 35V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        <circle cx="13" cy="13" fill="currentColor" r="3.2" />
        <circle cx="35" cy="35" fill="currentColor" r="3.2" />
        <circle cx="35" cy="13" fill="currentColor" r="2.2" />
      </svg>
    </span>
  );
}
