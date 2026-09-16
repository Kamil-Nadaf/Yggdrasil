/** Plain native date input, shared by main-task and subtask rows. */
export default function DeadlinePicker({
  value,
  onChange,
  title = "Set deadline",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  title?: string;
}) {
  return (
    <input
      type="date"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      title={title}
      className="deadline-picker-input mono"
    />
  );
}
