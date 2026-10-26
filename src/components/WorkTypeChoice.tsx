import { BriefcaseBusiness, UserRound } from 'lucide-react'
import type { WorkType } from '../lib/types'

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  employee: 'Full-time employee',
  freelancer: 'Freelancer',
}

const OPTIONS: { value: WorkType; text: string; icon: typeof UserRound }[] = [
  { value: 'employee', text: 'Your days off come in automatically from Sodeco.', icon: BriefcaseBusiness },
  { value: 'freelancer', text: 'You add your own days off in the holiday planner.', icon: UserRound },
]

/** The two big "Full-time employee / Freelancer" buttons. */
export default function WorkTypeChoice({
  value,
  onChange,
  name = 'work-type',
}: {
  value: WorkType | null
  onChange: (value: WorkType) => void
  name?: string
}) {
  return (
    <div className="@container">
      <div role="radiogroup" className="grid gap-2.5 @md:grid-cols-2">
        {OPTIONS.map(({ value: option, text, icon: Icon }) => {
          const selected = value === option
          return (
            <label
              key={option}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border-[1.5px] p-3 transition ${
                selected ? 'border-primary bg-primary/8' : 'border-line hover:border-primary/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={selected}
                  onChange={() => onChange(option)}
                  className="accent-[var(--primary)]"
                />
                <Icon className={`size-4 ${selected ? 'text-primary' : 'text-muted'}`} />
                <span className="text-sm font-semibold">{WORK_TYPE_LABEL[option]}</span>
              </span>
              <span className="text-xs leading-snug text-muted">{text}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
