
import Button from "../components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white p-10">
      <h1 className="text-5xl font-bold">
        GoalPulse
      </h1>

      <p className="text-slate-400 mt-4">
        Enterprise goal management platform
      </p>

      <div className="mt-8">
        <Button>
          Create Goal
        </Button>
      </div>
    </main>
  );
}