import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/** Minimal shadcn-style primitives on the Element Tree palette. */

type Variant = 'default' | 'primary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  default: 'border border-line2 bg-panel2 text-[#e7eef4] hover:border-teal hover:bg-panel',
  primary: 'border border-teal bg-teal text-[#04222a] hover:opacity-90',
  ghost: 'border border-transparent bg-transparent text-mut hover:text-[#e7eef4] hover:border-line',
  danger: 'border border-transparent bg-transparent text-dim hover:text-bad hover:bg-bad/15',
}

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-[#e7eef4] outline-none focus:border-teal ${className}`}
      {...props}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-xs text-mut">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11.5px] leading-normal text-dim">{hint}</div>}
    </div>
  )
}

export function Badge({ tone = 'mut', children }: { tone?: 'ok' | 'err' | 'warn' | 'mut'; children: ReactNode }) {
  const tones = {
    ok: 'text-ok border-ok/40 bg-ok/10',
    err: 'text-bad border-bad/40 bg-bad/10',
    warn: 'text-amber border-amber/40 bg-amber/10',
    mut: 'text-mut border-line bg-transparent',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 font-mono text-[10.5px] tracking-[.5px] ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="#3194a0" strokeWidth="6" />
      <path d="M50 20 L50 80 M30 34 L70 34 M38 50 L62 50" stroke="#4bbecb" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}
