import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// -- ThermalOps presentation helpers ---------------------------------------------

export function riskColor(level: string | null | undefined): string {
  switch (level) {
    case 'LOW': return '#16a34a';        // green-600
    case 'ELEVATED': return '#f59e0b';   // amber-500
    case 'CRITICAL': return '#dc2626';    // red-600
    default: return '#64748b';           // slate-500 (unknown)
  }
}

export function riskBadgeClass(level: string | null | undefined): string {
  switch (level) {
    case 'LOW':
      return 'bg-green-500/15 text-green-300 border-green-500/40'
    case 'ELEVATED':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    case 'CRITICAL':
      return 'bg-red-500/15 text-red-300 border-red-500/40'
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/40'
  }
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return '—'
  switch (action) {
    case 'clear': return 'Clear'
    case 'advisory': return 'Advisory'
    case 'stop_work_order': return 'Stop-Work Order'
    case 'emergency_escalate': return 'Emergency Escalate'
    default: return action
  }
}

export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return '—'
  switch (tier) {
    case 'rule': return 'Rule'
    case 'flash': return 'Gemini Flash'
    case 'pro': return 'Gemini Pro'
    case 'deferred': return 'Deferred'
    case 'skip': return 'Skipped'
    case 'error': return 'Error'
    default: return tier
  }
}

export function tierClass(tier: string | null | undefined): string {
  switch (tier) {
    case 'pro': return 'bg-violet-500/15 text-violet-300 border-violet-500/40'
    case 'flash': return 'bg-sky-500/15 text-sky-300 border-sky-500/40'
    case 'rule': return 'bg-slate-500/15 text-slate-300 border-slate-500/40'
    default: return 'bg-slate-700/30 text-slate-400 border-slate-600/40'
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    const diff = Date.now() - date.getTime()
    const sec = Math.floor(diff / 1000)
    if (sec < 5) return 'just now'
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    return date.toLocaleString()
  } catch {
    return iso
  }
}

export function formatNumber(n: number | null | undefined, suffix = ''): string {
  if (n === null || n === undefined) return '—'
  return `${Number(n).toFixed(1)}${suffix}`
}

// -- Shift-plan helpers ------------------------------------------------------------

export type HourClassification = 'SAFE' | 'CAUTION' | 'RESTRICTED' | 'STOP'

export function classificationColor(c: HourClassification): string {
  switch (c) {
    case 'SAFE': return '#16a34a'        // green-600
    case 'CAUTION': return '#eab308'     // yellow-500
    case 'RESTRICTED': return '#f97316'  // orange-500
    case 'STOP': return '#dc2626'        // red-600
  }
}

export function classificationLabel(c: HourClassification): string {
  switch (c) {
    case 'SAFE': return 'Safe'
    case 'CAUTION': return 'Caution'
    case 'RESTRICTED': return 'Restricted'
    case 'STOP': return 'Stop-work'
  }
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24
  const ampm = hh < 12 ? 'AM' : 'PM'
  const disp = hh % 12 === 0 ? 12 : hh % 12
  return `${disp}${ampm}`
}
