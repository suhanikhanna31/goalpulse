
interface Props {
  label: string;
  value: string;
}

export default function StatsCard({
  label,
  value,
}: Props) {
  return (
    <div
      style={{
        background: "#0f172a",
        padding: "20px",
        borderRadius: "16px",
      }}
    >
      <p style={{ color: "#94a3b8" }}>
        {label}
      </p>

      <h2>{value}</h2>
    </div>
  );
}
