export default function BuildingIcon({ size = 24, strokeWidth = 1.6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 43h42M9 43V25h8v18M14 25V15L24 9l9 6v28M24 9v34M33 30l6 3v10" />
    </svg>
  );
}
