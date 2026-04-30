import clsx from "clsx";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const SIZE = {
  sm: "h-3.5 w-3.5 border-[1.5px]",
  md: "h-5 w-5 border-2",
  lg: "h-7 w-7 border-[2.5px]",
};

export function Spinner({ size = "md", label, className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading…"}
      className={clsx("inline-flex items-center gap-2", className)}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "inline-block animate-spin rounded-full border-current border-r-transparent",
          SIZE[size],
        )}
      />
      {label && (
        <span className="text-[12px] text-ink-500">{label}</span>
      )}
    </span>
  );
}
