type Props = {
  label: string
  value: number | null | undefined
  size?: number
}

const colorFor = (v: number) => {
  if (v >= 85) return 'var(--danger)'
  if (v >= 70) return 'var(--warn)'
  return 'var(--ok)'
}

export const Gauge = ({ label, value, size = 72 }: Props) => {
  const pct = value == null || Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value))
  const r = (size - 10) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  const color = value == null ? 'var(--muted)' : colorFor(pct)

  return (
    <div style={{ textAlign: 'center', width: size + 8 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--gauge-track)"
          strokeWidth="7"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          fill="var(--text)"
          fontSize="13"
          fontWeight="700"
        >
          {value == null ? '—' : `${Math.round(pct)}%`}
        </text>
      </svg>
      <div className="muted sm" style={{ marginTop: 2, fontWeight: 650 }}>
        {label}
      </div>
    </div>
  )
}
