/** Three chevrons growing in size, like fast-forward zooming toward you. */
export default function Logo() {
  return (
    <svg className="ff-logo" viewBox="0 0 128 64" role="img" aria-label="Tempo Run">
      <defs>
        <linearGradient id="ff-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="rgb(205,180,255)" />
          <stop offset="0.4" stopColor="rgb(160,110,240)" />
          <stop offset="0.75" stopColor="rgb(190,72,200)" />
          <stop offset="1" stopColor="rgb(222,62,160)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#ff-grad)" strokeLinecap="round" strokeLinejoin="round">
        <path className="ff c1" d="M14 22 L26 32 L14 42" strokeWidth="7" />
        <path className="ff c2" d="M38 15 L56 32 L38 49" strokeWidth="8.5" />
        <path className="ff c3" d="M70 6 L96 32 L70 58" strokeWidth="10" />
      </g>
    </svg>
  );
}
