# Paradise City Office: status

*Last updated: 17 November 2026*

## At a glance

| Part | Status |
|---|---|
| Website | ✅ Live at https://quintencasteleyn.github.io/meetingroombookerparadisecityoffice/ |
| Holiday planner | ✅ Live. Freelancers and other, and the French and Austrian team, add their own days off; full-time employees' days off will come from Sodiwe |
| Three groups | ✅ Live (full-time employee, freelancers and other, French and Austrian team) |
| FAQ | ✅ Live, including "How do I change my status? Ask one of the admins" |
| Meeting rooms | ⏸️ Paused: hidden from the menu, Admin and the FAQ. Bookings are kept |
| Weekly "who's off" email | ⏸️ Built and tested, but the Friday schedule is **off** until your GO |
| Sodiwe connection | 🟡 The certificate works (valid until 30 May 2036). **Sodiwe doesn't recognise the employer number yet:** waiting on Sodiwe (see below) |

## Done

- Holiday planner: one or two months side by side (stacked on a phone), names on every day, Belgian public holidays, "off today / this week / your days off" panel.
- Three groups, chosen at sign-up or the first time someone signs in: **full-time employee** (Paradise City, days off from Sodiwe), **freelancers and other**, and **French and Austrian team** (these two add their own days off).
- Full-time employees confirm who they are by picking their name ("Are you one of the following persons?"). That links their account to their Sodiwe days off, also when the email on the list was different. The names are only shown after signing in, not on the public sign-up page.
- Days off by hand only for people who aren't full-time employees (by themselves, or by an admin for them). Full-time employees' days off only come from Sodiwe; the database enforces it.
- Employee list in Admin → Holidays: paste email, name and Sodiwe worker number from Excel.
- Weekly email: next week ("Full week" or the exact days) plus the 4 weeks after. Preview and "Send me a test" in Admin → Holidays. The automatic Friday schedule is switched off.
- Sodiwe sync, built on Sodiwe's own Link2Prisma documentation: reads the approved absences, waits for Sodiwe's queue, matches worker numbers to the employee list. It runs every night on GitHub and skips by itself until the certificate is there.
- "Test the connection only" option for the Sodiwe sync, which needs nothing but the certificate (and the employer number for the second half).
- The sync handles the certificate's older encryption type, and works without a certificate password.
- This repository is public, so the sync only ever prints **counts** in GitHub's logs: never names, email addresses, worker numbers or dates.
- Renamed Sodeco → Sodiwe everywhere people see it.
- Received: Paradise City's number in Sodiwe's files is **29717** (Sodiwe's API doesn't accept it as the employer number, see below). Touquet Music Beach is not in Sodiwe (its colleagues choose the French and Austrian team or freelancers and other).
- Received: Sodiwe's list of employees (8 people at PARADISE CITY BV) with names and worker numbers. It's kept out of this repository because it's personal data; it goes into Admin → Holidays. It has no email addresses, so Claude suggested firstname@paradisecity.be for each, to be checked before pasting.
- Supabase: all database updates run, up to `20261117000000_three_groups.sql` (17 November); all functions deployed.
- Connection test on 17 November: Sodiwe **accepts the certificate** from GitHub. So there is no IP restriction, and `link2prisma.sodeco.info/link2prisma.svc` is the right address.

## Waiting on you (in this order)

1. **Ask Sodiwe for the employer number** the API expects (see "Waiting on Sodiwe"). Put it in **GitHub → Settings → Secrets and variables → Actions → Variables → `SODIWE_EMPLOYER`**, then tell Claude, who runs the connection test again.
2. **Admin → Holidays → Add or update employees:** paste the full-time employees (email, full name, Sodiwe worker number). A wrong email is fixed automatically when that person picks their name at first sign-in.
3. **GitHub secret `SUPABASE_SERVICE_ROLE_KEY`:** from Supabase → Project Settings → API Keys (the secret key). Needed for the real sync.
4. Then: *Show what would change* → *Sync for real*. From then on it runs every night.

## Waiting on Sodiwe

- **The employer number for the API.** Every request for the absences gets the answer *"404.01 The given Employer is not found"*. Tried in the `Employer` header: `29717`, `029717` and `1518-029717` (the number on the payslips). Sodiwe's manual asks for the employer's *external number* in Prisma. Ask Sodiwe:
  - which exact value goes in the `Employer` header for PARADISE CITY BV;
  - whether the certificate's user ("Sodiwe PARADISECITY") has read rights on that employer.
- Still open from your first email: are your employees' holidays registered in the absence calendar in Prisma? (Only those come through the API.)

## Open questions for you

1. **Sick leave:** once the connection test shows which absence codes Sodiwe uses, should sick-leave codes be left out of the planner?
2. **Weekly email, for the GO:**
   - Sender address: the room-booking mailbox, or another one?
   - Recipients: everyone in BCC, or a group address?
   - Day and time: Friday afternoon about next week?
   - Then add `CRON_SECRET` in Supabase and GitHub (README step 9).
3. **Repository visibility:** the code is public. That's fine for the code (no secrets are in it, and the logs only show counts). Make it private only if you prefer; GitHub Pages on a private repository needs a paid GitHub plan.

## Good to know

- Claude can't test the Sodiwe connection from its own cloud environment: that environment's network proxy can't pass a client certificate on. GitHub's servers can, which is why the test runs there.
- GitHub starts the "nightly" job late when it's busy (lately around midday instead of 05:15). That's normal for GitHub's schedules and only means the planner updates a bit later in the day.
- Free Supabase projects pause after about a week without activity (this happened once already). Once the Sodiwe sync runs every day, it keeps the project awake; the Pro plan avoids it entirely.

## Changes

| Pull request | What |
|---|---|
| #3 | Holiday planner, weekly email, Sodiwe sync, FAQ |
| #4 | Weekly email schedule off until the GO |
| #5 | Days off by hand only for freelancers, Sodeco → Sodiwe, meeting rooms paused |
| #6 | Sodiwe connection test, certificate support, counts-only logs, this status file |
| #7 | The 20261026 database update can safely be run twice |
| #8 | Status: employer number and employee list received |
| #9 | Three groups: full-time employee, freelancers and other, French and Austrian team |
| #10 | The Sodiwe sync shows Sodiwe's own reason when it refuses a request |
| #11 | Status: the certificate works, the employer number isn't recognised yet |

Setup details for every step are in the [README](../README.md).
