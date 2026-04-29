interface SectionDividerProps {
  label?: string;
  className?: string;
}

export function SectionDivider({ label, className = "" }: SectionDividerProps) {
  if (!label) {
    return <hr className={`border-ink-200 ${className}`} />;
  }
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <hr className="flex-1 border-ink-200" />
      <span className="text-heading shrink-0">{label}</span>
      <hr className="flex-1 border-ink-200" />
    </div>
  );
}
