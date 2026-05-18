export default function Button({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <button
      className="
        bg-blue-600
        hover:bg-blue-700
        transition
        px-4
        py-2
        rounded-xl
        text-white
        font-medium
      "
    >
      {children}
    </button>
  );
}