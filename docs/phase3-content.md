# Phase 3 content — wording for approval (D8)

Status: **draft for the product owner's approval** (Nov 19, 2026). Nothing here ships until it is approved. Family language, no clinical terms, no scoring, nothing conditional on check-ins or the babies' data, nothing sent automatically.

## 1. Check-in (More → Support)
- **Heading:** How are you doing?
- **Scale (1–5), one tap:** 1 Really hard · 2 Hard · 3 Getting by · 4 Okay · 5 Good
- **Note (optional, one line):** placeholder "Anything you want to remember (optional)"
- **Privacy line, always shown:** "Only you can see your check-ins. You can share one with your partner if you want to."
- **List of past check-ins:** date, the word you picked, your note, and "Shared" when shared.
- **Share:** "Share with my partner" → confirm "Your partner will see this check-in in the family journey. You can unshare it later." · **Unshare:** "Stop sharing" → "Removed from the family journey. Your private check-in stays here."
- **Shared copy in the journey:** journal by "Me" (shows as the author's name to the partner), title "{word} today", the note as written (empty if none).

## 2. Supportive messages
One shown at a time on Support, chosen by the date (the same message all day, a new one each day). Never chosen from a check-in or anything the babies' records say.
1. You don't have to have it all figured out today.
2. Some days are about getting through. That's enough.
3. It's okay to feel more than one thing at once.
4. Rest is part of taking care of them. The NICU team is with them right now.
5. You're allowed to go home and sleep.
6. Asking a nurse to explain something again is part of the job, not a bother.
7. Eating a real meal and drinking water counts today.
8. The time you spend with them matters, even when it's short.
9. Small steps still move forward.
10. When people offer to help, let them. Dinner, laundry, a ride.
11. Your partner may be feeling this differently. Both ways are okay.
12. A hard moment today isn't the whole story.

## 3. Parent milestones ("Me", scope `parent`)
Offered in Add a moment when "Me" is picked, alongside Journal and Write your own. Recorded by a parent only.

| Key | Title |
|---|---|
| `first-rounds` | First time joining rounds |
| `first-solo-care` | First care time on my own |
| `first-pump` | First pumping session |
| `met-nicu-parent` | Met another NICU parent |
| `asked-for-help` | Asked for help |
| `first-full-night` | First full night's sleep |
| `time-for-me` | Took time for myself |
| `first-walk-out` | First walk outside for me |

## 4. Resources (More → Support → Resources)
Static, works with no signal. US resources (see §5). The crisis box is at the top and visible without scrolling.

**Crisis box (always first):**
> **If you're thinking about harming yourself, or don't feel safe,** call or text **988** (Suicide & Crisis Lifeline), any time, free. **In an emergency, call 911.**
> Buttons: Call 988 · Text 988

**Support for parents:**
- **National Maternal Mental Health Hotline** — call or text **1-833-TLC-MAMA (1-833-852-6262)**, 24/7, free and confidential. Support for pregnant and new parents and their families. *(HRSA)*
- **Postpartum Support International HelpLine** — call or text **1-800-944-4773** (Spanish text: 971-203-7773). Leave a message; a trained volunteer gets back to you, usually during business hours. Not for emergencies. Free online groups, including groups for NICU parents. postpartum.net
- **Hand to Hold** — free peer mentors (parents who've been through the NICU) and support groups, in English and Spanish. handtohold.org
- **Your NICU's social worker** — every NICU has one. Ask your baby's nurse to connect you; they can help with stress, money, lodging and getting home.

Footer: "These are independent services, not part of this app. This app doesn't read or send anything about your check-ins."

## 5. Market decision (open item)
Proposed: **US only for now** (the only family using the app is in the US). Every screen that lists resources adds: "Outside the US? Call your local emergency number." Country handling waits until the app is offered outside the US (Phase 6).

## Sources checked (Nov 19, 2026)
- 988: call, text or chat, 24/7, free; 911 first in immediate danger — [SAMHSA 988 key messages](https://www.samhsa.gov/resource/988/988-key-messages), [988 factsheet](https://www.samhsa.gov:443/sites/default/files/988-factsheet.pdf).
- National Maternal Mental Health Hotline 1-833-TLC-MAMA, call or text, 24/7 — [HRSA](https://www.hrsa.gov/taxonomy/term/264), [MMHLA](https://www.mmhla.org/articles/national-maternal-mental-health-hotline-celebrates-one-year-anniversary-upcoming-webinar-to-share-information).
- PSI HelpLine 1-800-944-4773, Spanish text 971-203-7773, volunteers return messages — [PSI HelpLine](https://www.postpartum.net/get-help/psi-helpline/).
- Hand to Hold peer mentors and free groups — [Hand to Hold](https://handtohold.org/nicu-family-support/).
