import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAdmins } from '../lib/holidays'
import { ROOMS_ENABLED } from '../lib/features'

function Question({ q, children, open = false }: { q: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-surface px-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-[14.5px] font-semibold [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="max-w-[65ch] space-y-2 pb-4 text-sm leading-relaxed text-muted">{children}</div>
    </details>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="pt-3 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  )
}

export default function FaqPage() {
  const admins = useAdmins()

  const adminList = (
    <ul className="space-y-1">
      {admins.map((a) => (
        <li key={a.email}>
          {a.full_name}:{' '}
          <span className="select-all rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">{a.email}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-2 px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold">Questions</h1>
      <p className="text-sm text-muted">
        Short answers about your account{ROOMS_ENABLED ? ', holidays and the meeting rooms' : ' and the holiday planner'}.
      </p>

      <Group title="Your account">
        <Question q="How do I change my status (my group)?" open>
          <p>Ask one of the admins. They can change it for you in Admin → Users.</p>
          {adminList}
        </Question>
        <Question q="Why do I have to choose a group?">
          <p>
            There are three groups: full-time employees of Paradise City, freelancers and other, and the French and
            Austrian team. Full-time employees' days off come in automatically from Sodiwe, our HR system. The other two
            groups aren't in Sodiwe, so they add their own days off here. Your group tells the planner where to look.
          </p>
          <p>
            Full-time employees confirm who they are by picking their name from the list the first time they sign in.
          </p>
        </Question>
        <Question q="How do I change my name, colours or password?">
          <p>Click your name at the top right and choose Settings & colours.</p>
        </Question>
        <Question q="I forgot my password.">
          <p>On the sign-in page, click “Forgot password?” and we'll email you a link to choose a new one.</p>
        </Question>
      </Group>

      <Group title="Holidays">
        <Question q="I'm a full-time employee. How do I book a holiday?">
          <p>
            Request it in Sodiwe, as you do today. Once it's approved, the holiday planner picks it up during the night,
            so it shows up here the next morning. You can't add or change these days in the planner yourself: they always
            come from Sodiwe.
          </p>
        </Question>
        <Question q="I'm a freelancer or in the French or Austrian team. How do I add my days off?">
          <p>
            Open Holidays and click “Add days off”. Pick the first and last day, or a morning or afternoon for a half
            day. Your colleagues see them straight away.
          </p>
        </Question>
        <Question q="How do I change or remove days off I added?">
          <p>
            Click one of the days in the calendar, or look under “Your days off” on the right. Use the pencil to change
            them or the bin to remove them. Days off that come from Sodiwe can only be changed in Sodiwe.
          </p>
        </Question>
        <Question q="Who can see my days off?">
          <p>
            Everyone with an account sees your name on the days you're off. Nobody sees why: the type of leave, sick
            leave and balances stay in Sodiwe.
          </p>
        </Question>
        <Question q="What is the weekly email?">
          <p>
            Every Friday afternoon everyone gets an email with who is off next week. For each person it says “Full week”
            or the exact days. Below that is an overview of the 4 weeks after.
          </p>
        </Question>
        <Question q="Are public holidays included?">
          <p>Yes. Belgian public holidays are marked in red and don't count as anyone's day off.</p>
        </Question>
        <Question q="My days off are missing or wrong.">
          <p>
            Full-time employees: check Sodiwe first. The planner copies it every night. Everyone else: change them
            yourself. Still not right? Ask one of the admins.
          </p>
          {adminList}
        </Question>
      </Group>

      {ROOMS_ENABLED && (
        <Group title="Meeting rooms">
          <Question q="How do I book a meeting room?">
            <p>Open Rooms, then click or drag in the calendar. You can add guests and repeat a booking.</p>
          </Question>
          <Question q="The room I need is taken. What now?">
            <p>
              Click the booking to see which rooms are still free, ask the organiser to switch rooms, or join the waiting
              list. When the booking is cancelled, the first person waiting gets the room automatically.
            </p>
          </Question>
        </Group>
      )}
    </div>
  )
}
