"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AnalyticsChartProps {
  goals: any[];
}

export default function AnalyticsChart({
  goals,
}: AnalyticsChartProps) {
  const data = [
    {
      name: "Draft",
      value: goals.filter(
        (g) => g.status === "draft"
      ).length,
    },
    {
      name: "Approved",
      value: goals.filter(
        (g) => g.status === "approved"
      ).length,
    },
    {
      name: "Pending",
      value: goals.filter(
        (g) => g.status === "pending"
      ).length,
    },
  ];

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />

          <Bar
            dataKey="value"
            radius={[10, 10, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}