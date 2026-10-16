export function SectionTabs<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="section-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const current = options.findIndex((option) => option.id === value);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (current +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  options.length) %
                options.length;
        onChange(options[next].id);
        event.currentTarget
          .querySelectorAll<HTMLButtonElement>('[role="tab"]')
          [next]?.focus();
      }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          id={`${id}-tab-${option.id}`}
          aria-controls={`${id}-panel-${option.id}`}
          aria-selected={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
