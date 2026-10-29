import React, { useEffect, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark" ||
  (!document.documentElement.getAttribute("data-theme") &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);

function baseOptions() {
  const dark = isDark();
  const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = dark ? "#9aa4bd" : "#5b6478";
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    plugins: {
      legend: { display: false },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
    },
  };
}

/** Bar chart for per-cell voltage/temperature readouts, colored by min/max/normal. */
export function CellBarChart({ labels, values, colors, unit }) {
  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
        maxBarThickness: 28,
      },
    ],
  };
  return (
    <div className="chart-wrap">
      <Bar
        data={data}
        options={{
          ...baseOptions(),
          plugins: {
            ...baseOptions().plugins,
            tooltip: { callbacks: { label: (ctx) => `${ctx.formattedValue} ${unit || ""}` } },
          },
        }}
      />
    </div>
  );
}

/**
 * Rolling line chart for a scalar (voltage/current/SOC/temperature) over the
 * last N samples. `beginAtZero` (default true) forces the y-axis to start at
 * 0 rather than auto-scaling to the sample min/max, so small real-world
 * fluctuations (e.g. pack voltage bobbing by a few hundredths of a volt)
 * don't get visually exaggerated into sharp peaks - a 0.01V wobble on a
 * 54.54V pack is normal ripple, not a spike, and the chart should read that
 * way at a glance.
 */
export function TrendLineChart({ label, value, color, unit, maxPoints = 60, beginAtZero = true }) {
  const historyRef = useRef({ labels: [], values: [] });

  useEffect(() => {
    const h = historyRef.current;
    h.labels.push(new Date().toLocaleTimeString().slice(0, 8));
    h.values.push(value);
    if (h.labels.length > maxPoints) {
      h.labels.shift();
      h.values.shift();
    }
  }, [value, maxPoints]);

  const h = historyRef.current;
  const data = {
    labels: h.labels,
    datasets: [
      {
        label,
        data: h.values,
        borderColor: color,
        backgroundColor: color + "22",
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };
  return (
    <div className="chart-wrap">
      <Line
        data={data}
        options={{
          ...baseOptions(),
          plugins: {
            ...baseOptions().plugins,
            tooltip: { callbacks: { label: (ctx) => `${ctx.formattedValue} ${unit || ""}` } },
          },
          scales: {
            ...baseOptions().scales,
            y: { ...baseOptions().scales.y, beginAtZero },
          },
        }}
      />
    </div>
  );
}
