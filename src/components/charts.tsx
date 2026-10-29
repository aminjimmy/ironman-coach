import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend,
  type ChartOptions,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import type { LoadDay } from "../lib/metrics";
import { fmtDate, SPORT_META } from "../lib/format";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);
ChartJS.defaults.color = "#b4bfcc";
ChartJS.defaults.font.family = "system-ui, -apple-system, Roboto, sans-serif";
ChartJS.defaults.font.size = 11;
ChartJS.defaults.borderColor = "rgba(125,138,155,0.15)";

const SURFACE = "#131a23";
export const CTL_COLOR = "#3987e5";
export const ATL_COLOR = "#d95926";
const NEUTRAL = "#7d8a9b";

const tooltip = {
  backgroundColor: "#1a2330",
  borderColor: "#243041",
  borderWidth: 1,
  titleColor: "#eef2f6",
  bodyColor: "#b4bfcc",
  padding: 10,
  boxPadding: 4,
  usePointStyle: true,
};

function baseOpts(yTitle?: string): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip },
    elements: { point: { radius: 0, hoverRadius: 5, hoverBorderWidth: 2, hoverBorderColor: SURFACE }, line: { borderWidth: 2, tension: 0.25 } },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
      y: { grid: { color: "rgba(125,138,155,0.12)" }, border: { display: false }, title: yTitle ? { display: true, text: yTitle } : undefined, ticks: { maxTicksLimit: 5 } },
    },
  };
}

export function FitnessChart({ data, targetCtl }: { data: LoadDay[]; targetCtl?: [number, number] }) {
  const labels = data.map((d) => fmtDate(d.date));
  const opts = baseOpts();
  return (
    <>
      <div className="chart-box">
        <Line
          options={opts}
          data={{
            labels,
            datasets: [
              { label: "Fitness (CTL)", data: data.map((d) => +d.ctl.toFixed(1)), borderColor: CTL_COLOR, backgroundColor: "rgba(57,135,229,0.12)", fill: true },
              { label: "Fatigue (ATL)", data: data.map((d) => +d.atl.toFixed(1)), borderColor: ATL_COLOR },
              ...(targetCtl
                ? [{ label: "Race-ready fitness (min)", data: data.map(() => targetCtl[0]), borderColor: NEUTRAL, borderDash: [4, 4], borderWidth: 1.5, pointHoverRadius: 0 }]
                : []),
            ],
          }}
        />
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: CTL_COLOR }} />Fitness (CTL)</span>
        <span><i className="swatch" style={{ background: ATL_COLOR }} />Fatigue (ATL)</span>
        {targetCtl && <span><i className="swatch" style={{ background: "transparent", borderTop: `2px dashed ${NEUTRAL}`, height: 0 }} />Race-ready ≥{targetCtl[0]}</span>}
      </div>
      <div className="chart-box short" style={{ marginTop: 10 }}>
        <Bar
          options={{
            ...(baseOpts("Form (TSB)") as unknown as ChartOptions<"bar">),
            plugins: { legend: { display: false }, tooltip },
          }}
          data={{
            labels,
            datasets: [{
              label: "Form (TSB)",
              data: data.map((d) => +d.tsb.toFixed(1)),
              backgroundColor: NEUTRAL,
              borderRadius: 2,
              barPercentage: 1,
              categoryPercentage: 0.9,
            }],
          }}
        />
      </div>
    </>
  );
}

export function WeeklyVolumeChart({ weeks }: { weeks: { label: string; swim: number; bike: number; run: number; other: number; planned?: number }[] }) {
  const ds = (["swim", "bike", "run", "other"] as const).map((s) => ({
    type: "bar" as const,
    label: SPORT_META[s].label,
    data: weeks.map((w) => +w[s].toFixed(2)),
    backgroundColor: SPORT_META[s].color,
    borderColor: SURFACE,
    borderWidth: { top: 2 },
    borderRadius: 4,
    borderSkipped: false as const,
    stack: "h",
  }));
  const hasPlanned = weeks.some((w) => w.planned);
  return (
    <>
      <div className="chart-box">
        <Bar
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: { ...tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${(+(c.raw as number)).toFixed(1)} h` } },
            },
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
              y: { stacked: true, grid: { color: "rgba(125,138,155,0.12)" }, border: { display: false }, title: { display: true, text: "hours" }, ticks: { maxTicksLimit: 5 } },
            },
          }}
          data={{
            labels: weeks.map((w) => w.label),
            datasets: [
              ...ds,
              ...(hasPlanned
                ? [{
                    type: "line" as const,
                    label: "Planned",
                    data: weeks.map((w) => w.planned ?? null),
                    borderColor: "#eef2f6",
                    borderDash: [4, 4],
                    borderWidth: 1.5,
                    pointRadius: 3,
                    pointBackgroundColor: "#eef2f6",
                    stack: "p",
                  }]
                : []),
            ] as never,
          }}
        />
      </div>
      <div className="legend">
        {(["swim", "bike", "run", "other"] as const).map((s) => (
          <span key={s}><i className="swatch" style={{ background: SPORT_META[s].color }} />{SPORT_META[s].label}</span>
        ))}
        {hasPlanned && <span><i className="swatch" style={{ background: "transparent", borderTop: "2px dashed #eef2f6", height: 0 }} />Planned</span>}
      </div>
    </>
  );
}

export function SeriesChart({ x, y, color, label, format, invert, height = "short" }: {
  x: number[]; y: (number | null)[]; color: string; label: string; format?: (v: number) => string; invert?: boolean; height?: "short" | "" | "tall";
}) {
  const opts = baseOpts();
  opts.plugins = {
    legend: { display: false },
    tooltip: {
      ...tooltip,
      callbacks: {
        title: (items) => `${(x[items[0].dataIndex] / 1000).toFixed(2)} km`,
        label: (c) => `${label}: ${format ? format(c.raw as number) : Math.round(c.raw as number)}`,
      },
    },
  };
  opts.scales!.x = { type: "linear", grid: { display: false }, ticks: { maxTicksLimit: 6, callback: (v) => `${(+v / 1000).toFixed(0)} km` } };
  opts.scales!.y = { ...(opts.scales!.y as object), reverse: !!invert, ticks: { maxTicksLimit: 4, callback: (v) => (format ? format(+v) : v) } };
  opts.elements!.line = { borderWidth: 1.5, tension: 0 };
  return (
    <div className={`chart-box ${height}`}>
      <Line options={opts} data={{ datasets: [{ label, data: x.map((xv, i) => ({ x: xv, y: y[i] })) as never, borderColor: color, backgroundColor: color, spanGaps: true }] }} />
    </div>
  );
}

export function WeightChart({ points }: { points: { date: string; kg: number }[] }) {
  const opts = baseOpts("kg");
  opts.plugins = { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (c) => `${c.raw} kg` } } };
  opts.elements!.point = { radius: 3, hoverRadius: 6, backgroundColor: CTL_COLOR, borderColor: SURFACE, borderWidth: 2 };
  return (
    <div className="chart-box short">
      <Line options={opts} data={{ labels: points.map((p) => fmtDate(p.date)), datasets: [{ label: "Weight", data: points.map((p) => p.kg), borderColor: CTL_COLOR }] }} />
    </div>
  );
}
