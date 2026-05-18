
export default function Navbar() {
  return (
    <nav className="w-full border-b border-slate-800 bg-slate-950/70 backdrop-blur">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">
          GoalPulse
        </h1>

        <div className="flex gap-6 text-sm text-slate-300">
          <button className="hover:text-white transition">
            Dashboard
          </button>

          <button className="hover:text-white transition">
            Analytics
          </button>

          <button className="hover:text-white transition">
            Team
          </button>
        </div>
      </div>
    </nav>
  );
}