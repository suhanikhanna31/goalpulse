"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login() {
    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      alert(error.message);
    } else {
      alert("Logged in!");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">
          Login
        </h1>

        <div className="mt-6 space-y-4">
          <input
            placeholder="Email"
            className="w-full rounded-xl bg-slate-800 p-3"
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-xl bg-slate-800 p-3"
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          <button
            onClick={login}
            className="w-full rounded-xl bg-blue-600 p-3 font-semibold"
          >
            Login
          </button>
        </div>
      </div>
    </main>
  );
}