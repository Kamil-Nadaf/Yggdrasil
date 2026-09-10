interface GateStatus {
  passed: boolean;
  missing?: string[];
  aq_missing?: boolean;
}

export default function GateIndicator({ gate }: { gate?: GateStatus }) {
  if (!gate) return null;

  if (gate.passed) {
    return (
      <div className="gate-bar open">
        <span>✓</span>
        <span>Gate open — /examine available</span>
      </div>
    );
  }

  const parts: string[] = [];
  if (gate.missing && gate.missing.length > 0) {
    parts.push(`slots missing: ${gate.missing.join(", ")}`);
  }
  if (gate.aq_missing) {
    parts.push("aq_written not set");
  }

  return (
    <div className="gate-bar locked">
      <span>⊘</span>
      <span>Gate locked · {parts.join(" · ")}</span>
    </div>
  );
}
