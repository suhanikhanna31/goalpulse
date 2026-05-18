
interface Props {
  title: string;
  progress: number;
  owner: string;
}

export default function GoalCard({
  title,
  progress,
  owner,
}: Props) {
  return (
    <div
      style={{
        background: "#111827",
        padding: "24px",
        borderRadius: "18px",
      }}
    >
      <h3>{title}</h3>

      <p style={{ color: "#94a3b8" }}>
        Owner: {owner}
      </p>

      <div
        style={{
          height: "10px",
          background: "#334155",
          borderRadius: "999px",
          overflow: "hidden",
          marginTop: "18px",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            background: "#22c55e",
            height: "100%",
          }}
        />
      </div>

      <p style={{ marginTop: "10px" }}>
        {progress}% complete
      </p>
    </div>
  );
}
