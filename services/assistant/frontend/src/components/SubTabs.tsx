interface Props<T extends string> {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
}

/** Sub-section tab bar shown under the main nav (Papers, Tasks…). */
export default function SubTabs<T extends string>({ tabs, value, onChange, label }: Props<T>) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`subtab${value === t.id ? " active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
