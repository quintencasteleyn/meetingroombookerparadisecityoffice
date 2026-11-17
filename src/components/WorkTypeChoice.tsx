import type { ReactNode } from 'react'
import { BriefcaseBusiness, Globe, UserRound } from 'lucide-react'
import type { WorkType } from '../lib/types'

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  employee: 'Full-time employee',
  freelancer: 'Freelancers and other',
  france_austria: 'French and Austrian team',
}

/** Short names for the calendar and lists. */
export const WORK_TYPE_SHORT: Record<WorkType, string> = {
  employee: 'Full-time',
  freelancer: 'Freelancer or other',
  france_austria: 'French/Austrian team',
}

const OPTIONS: { value: WorkType; text: string; icon: typeof UserRound }[] = [
  { value: 'employee', text: 'Paradise City. Your days off come in automatically from Sodiwe.', icon: BriefcaseBusiness },
  { value: 'freelancer', text: 'You add your own days off in the holiday planner.', icon: UserRound },
  { value: 'france_austria', text: 'You add your own days off in the holiday planner.', icon: Globe },
]

/** The three groups to choose from: full-time employee, freelancers and other, French and Austrian team. */
export default function WorkTypeChoice({
  value,
  onChange,
  name = 'work-type',
  employeeExtra,
}: {
  value: WorkType | null
  onChange: (value: WorkType) => void
  name?: string
  /** Shown under "Full-time employee" once it's chosen. */
  employeeExtra?: ReactNode
}) {
  return (
    <div role="radiogroup" className="grid gap-2.5">
      {OPTIONS.map(({ value: option, text, icon: Icon }) => {
        const selected = value === option
        return (
          <div
            key={option}
            className={`rounded-xl border-[1.5px] transition ${
              selected ? 'border-primary bg-primary/8' : 'border-line hover:border-primary/50'
            }`}
          >
            <label className="flex cursor-pointer flex-col gap-1 p-3">
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
              <span className="pl-6 text-xs leading-snug text-muted">{text}</span>
            </label>
            {selected && option === 'employee' && employeeExtra && <div className="px-3 pb-3 pl-9">{employeeExtra}</div>}
          </div>
        )
      })}
    </div>
  )
}
