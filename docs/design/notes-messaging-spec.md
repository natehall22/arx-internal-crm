# Job Threads: Notes and Internal Messaging Spec

Prepared 2026-10-21 for the ARX internal CRM (`/home/claude/natehall22/arx-internal-crm`).

**Inputs**
- `customer-file-spec.md`, `desire-paths.md` and `audit-ux.md`
- The code was read, not run.
- Read-only aggregate SQL on Supabase `anzqkklwcgaoeunzpqjh`. It returned counts only, with no personal data.
- About 15 web searches and fetches.

**Nothing in the code or the database was changed.**

**Legend**
- **[V]** verified in code or DB
- **[I]** inferred
- **[W]** from the web (linked)
- **[E]** an estimate

**Scope.** Internal team only: setters, closers, inside sales, ops and owners. No crews and no homeowners in this version. The thing to beat is **the iMessage group text**, not another CRM.

---

## 0. The recommendation in plain words

**Build "Job Threads".** Every job gets its own group chat inside the CRM. It is named for the job, like "Hall · 123 Sample St". The right people are already in it: the setter who booked it, the closer, the ops person, and the owners. It should feel like the group text you have today, with five things a group text can't do:

1. **It's on the job.** Open the job and the whole conversation is there, plus gate codes and pets pinned at the top. A new hire sees the full history from day one. Nobody has to scroll a group text from March.
2. **The right people see the right things, automatically.**
   - Setters never see production talk or pricing.
   - Nobody picks an audience from a menu. The CRM works it out from who is writing and where, and it warns you if something looks like pricing.
3. **It knows what's waiting on you.**
   - A message can be FYI, "needs a reply" or urgent.
   - Each person has a "Waiting on you" list that empties as they answer.
   - FYI messages don't buzz your phone. They wait for the morning summary.
4. **Ask once and it becomes a task.** Long-press any message and choose "Make task", give it an owner and a due date, and it can't get lost.
5. **You can find anything.** Search every job conversation ever.

**What has to be true for anyone to use it, in this order:**
- **(a) Your phone buzzes when someone needs you, and you can reply from the lock screen.** This needs the ARX iPhone app, because iPhone web apps can't do lock-screen replies (§4.2). If push is off, an email (and later a text) follows.
- **(b) It opens in under a second, right to the message.**
- **(c) It works in a dead zone and sends later.**
- **(d) The owners stop answering job questions by text.** This is the real switch. The software only makes it painless.

**What it costs and how long it takes [E]:**
- A first usable version takes **about 4–5 weeks** for one developer working with AI help: job threads, iPhone and web push with reply, the Waiting on you list, and correct audience rules.
- Full parity with the group text takes **about 4 more weeks**: offline, voice, photos, the iPhone share button, tasks and the morning summary.
- **Texting a reply back into the thread** would add a Twilio number: about **$1.15/month** plus **under a cent per text** in carrier and Twilio fees [W], plus a carrier registration process. Leave it for later, and only add it if people are missing pushes.

**Decisions for Nathan** (listed in §13):
1. Will owners commit to answering job questions only in the thread, starting week 2?
2. Is everyone on an iPhone with the ARX app?
3. Are 1-on-1 messages allowed? Recommendation: yes, but nudge job talk into the job thread.
4. Should urgent messages escalate by SMS?

---

## 1. What exists today (and why notes aren't used)

### 1.1 The numbers [V, aggregate SQL]

| Signal | Number | What it means |
|---|---|---|
| Human-written notes in `activities` (type `note`) | **about 10–20 a month** across the whole company. Admins wrote almost all of them. Setters wrote 2 ever, canvassers 19. About 40% of `note` rows are actually system text ("Inspection report emailed…", "…created and sent to…", "Design PDF uploaded") | The team does not talk in the CRM. Job conversations happen in texts and calls. The "note" type is polluted by system rows. |
| `production_job_notes` by month | Mar 18 · **Apr 36** · May 8 · Jun 16 · Jul 15 · Aug 6 · Sep 5 · **Oct 0** | Ops notes peaked and then faded, which is the classic adoption-decay curve. |
| Job notes containing `@` | **54 of 104** (52%) | When people did use notes, half were trying to **reach someone**. The tool was used as messaging, but the message only went out by email (§1.2). |
| `notifications` read rate | `appointment_assigned` 47% read, **median 175 hours to read**. `new_lead` 0 of 13 read. Last notification written 10-08. | The in-app bell is not where anyone looks. A notification read a week later is useless. |
| iOS push devices | 4 production tokens (3 users) seen in the last 7 days, plus 3 stale sandbox tokens. **There is no web-push subscription table at all.** | Push reaches about 3 people today. |
| Active users / with phone on file | 12 / 9 | SMS fallback would cover 9 of 12 without more data entry. |
| Notes written 9pm–7am / on weekends | 43 of 305 (14%) / 39 of 305 (13%) | Work happens off-hours. Quiet hours must hold back FYI messages but let urgent ones through. |
| Note length | median 77 characters, mean 158 | These are chat-sized messages, not documents. |
| Supabase Realtime publication | **none** | There are no live updates. The bell polls every 10 s over SSE. |
| `pg_trgm` extension | installed | Fast fuzzy search over message text is available today. |

### 1.2 How it works in code [V]

- **Notes are in at least 11 places:**
  - the tables `activities`, `production_job_notes` and `work_order_comments` (0 rows)
  - 8 free-text columns: `leads.canvass_notes` (7,223), `opportunities.inspection_notes` (158), `.notes` (95), `projects.notes` (42), `.ops_notes` (29), `production_jobs.internal_notes` (31), `leads.notes` (31), `special_instructions` (3)

  This matches `customer-file-spec.md` §3.1.
- **@mentions only send an email.**
  - `app/api/ops/jobs/[id]/notes/route.ts` inserts the note, then sends a Nodemailer email to each mentioned user.
  - It creates **no `notifications` row and no push**.
  - Matching is fuzzy: a fragment that is a *prefix* of a name counts as a match (`normalizedUserName.startsWith(fragment)`), so `@Ste` can notify every "Ste…".
  - It also `console.log`s the recipients' **email addresses** (PII in logs).
- **The bell** is `app/api/notifications/stream/route.ts`, an SSE stream that polls the `notifications` table every 10 s. Its role checks are hardcoded (`['closer','rep','sales_rep','admin','manager']`).
- **iOS push** is `lib/push-apns.ts` (`sendPushToUser` / `sendPushToUserBackground`), and it works.
  - Only 3 callers use it: a new canvass lead, Sisu, and appointment changes.
  - The iOS `PushManager.routeNotification` routes a tap to a **tab only**, not to a record.
  - There are **no notification categories**, so no inline reply.
- **Web push:**
  - `public/canvass-sw.js` has a `push` handler ("for future use") and a `notificationclick` handler that opens `data.url`.
  - Nothing ever sends to it. There is no VAPID key, no `web-push` package and no subscription storage.
- **SMS:** there is no provider. The review-request flow builds an `sms:` link that opens the user's own Messages app (`components/reviews/ReviewRequestCard.tsx`).
- **Offline:** canvass has an offline queue (Zustand store, plus `OfflineLeadQueue.swift` on iOS). Background sync is stubbed in the service worker. Notes have no offline path.
- **Security findings:**
  - **RLS on `notifications` allows SELECT by any user in the org** (`org_id = get_user_org_id(auth.uid())`). With the browser client, anyone could read anyone's notifications, including the note text in `body`.
  - **RLS on `activities` and `production_job_notes` is org-wide**, so note privacy exists only in the UI. This is already flagged in the customer-file spec.
  - Fix both before job threads carry audience-restricted text (Phase 0).

### 1.3 Why CRM chat goes unused (research)

1. **Adoption is the failure point, not features.**
   - destinationCRM, on Chatter-style CRM collaboration: "The point of failure is user adoption." (May 2015) [destinationCRM](https://www.destinationcrm.com/Articles/Columns-Departments/Reality-Check/What-Weve-Got-Here-Is-Failure-to-Collaborate-104069.aspx)
   - Its point is that the tools rated well on interface and features. Use still shrank to a few loyal users. ARX's job-note curve (36 → 0 a month) is the same shape.
2. **The vendor itself gave up on its built-in chat.**
   - Salesforce bought Slack. Chatter is off by default in new orgs from Summer '26. "Salesforce has not announced a retirement date." (Apr 2026) [Salesforce Time](https://salesforcetime.com/2026/04/23/is-chatter-being-retired/)
   - **Lesson:** a feed bolted onto records loses to a real messenger unless it matches the messenger on reach and speed.
3. **Mentions you can't find or answer quickly.**
   - HubSpot users asked to see all their mentions in one place. The answer: "At this stage that's not possible, unfortunately." (Sep 2021) [HubSpot community](https://community.hubspot.com/t/see-all-my-mentions-in-one-place/44453)
   - Reply-to-mention by email was declined for the roadmap (Oct 2020). [HubSpot idea](https://community.hubspot.com/t5/HubSpot-Ideas/Reply-to-Mentions-via-email/idc-p/381874)
   - **Lesson:** a "Waiting on you" list and reply-from-the-notification are table stakes.
4. **Too many channels and pings.**
   - An HVAC contractor was "in so many Slack groups he can't get anything done." (Jul 2020) [ACHR News](https://achrnews.com/articles/143469-team-communication-apps-keep-hvac-contractors-in-touch-with-their-employees)
   - **Lesson:** one thread per job, owners on "important only", and no pushes for FYI.
5. **Notification batching helps, but zero notifications hurts.**
   - In Fitz et al. (2019, *Computers in Human Behavior*, n=200), batching notifications three times a day improved focus and well-being.
   - The no-notification group "felt more anxious, unlocked their phones more." [Georgia Tech summary](https://work21.gatech.edu/?p=402)
   - **Lesson:** push the few things that need a person now, and digest the rest. Never go silent.
6. **What the roofing CRM leader ships.**
   - AccuLynx job messages have threads per job, @mentions, admin tags, per-thread mute (others can see you muted), and "Turn conversations into actionable tasks with just a click!" [AccuLynx guide](https://acculynx.com/?p=6920)
   - Good pattern, but it is still a CRM inbox. The bar here is iMessage.
7. **Field apps must work offline.**
   - "Fieldwire provides offline editing in our mobile apps." It syncs when you have a signal again. [Fieldwire help](https://help.fieldwire.com/hc/en-us/articles/360043052832)
   - A roof or a rural driveway is a dead zone. A message that fails to send there sends the user back to iMessage, which queues.
8. **iPhone web-app push has hard limits.**
   - Web push on iPhone needs iOS 16.4 or later and the site added to the Home Screen, and permission must come from a tap. "A tab in Safari, Chrome, Edge, or Firefox cannot request permission." [OneSignal](https://documentation.onesignal.com/docs/en/web-push-for-ios)
   - If the user taps "Don't Allow", iOS won't ask again unless the app is re-added.
   - Notification **action buttons don't work** in iOS web push: "As of 2024-11-03, iOS is not supported yet." [Apple Developer Forums](https://developer.apple.com/forums/thread/726793). This is forum evidence, not Apple documentation.
   - **Consequence:** inline reply from the lock screen on iPhone requires the **native ARX Sales app** (`UNTextInputNotificationAction`, a standard iOS API).
9. **SMS cost (for fallback and reply-by-text).**
   - Twilio US SMS is **$0.0083 per segment** inbound or outbound, plus per-carrier fees of about $0.0025–$0.005. A long-code number is **$1.15/month**. [Twilio pricing](https://www.twilio.com/en-us/sms/pricing)
   - A2P 10DLC registration is required. The page says it is "subject to registration onboarding fees" but doesn't list them. Confirm before committing.

**Why iMessage wins today [I]:**
- It is already on every phone, and opening it costs 0 taps.
- Every message buzzes.
- The reply box is on the lock screen.
- Photos and voice take one tap.
- It queues offline.
- "Read" and typing indicators tell you you were heard.

**Where iMessage loses [I]:**
- It isn't tied to the job.
- New people can't see history.
- Anything is visible to everyone in the group, including setters seeing prices.
- There's no "who owes an answer", so questions die in scroll.
- Search is weak across many group chats.
- Android members break group features.

**Design rule:** match everything in the first list. Win on everything in the second.

---

## 2. The design at a glance

```
┌ Job thread = one group chat per deal (opportunity) ───────────────────────────┐
│ Members auto-added: setter · closer · ops lead · owners (owners = important)  │
│ Pinned: ⚠ Dog · Gate 4411 · Call tenant         (customer alerts, max 3)       │
│                                                                               │
│ Human messages = chat bubbles (audience tint, reply, react ✓, seen-by)         │
│ System events  = one collapsed gray line ("⟳ 4 updates · status, calls ▸")     │
│                                                                               │
│ Composer: [Production ▾ auto] [🎤][📷][!]  "Message…"   [Send]                 │
└───────────────────────────────────────────────────────────────────────────────┘
Waiting on you   = notifications(priority in needs_reply/urgent, unresolved) + tasks due
Push (iOS app)   = inline Reply · Done · Snooze 1h, deep link to the message
Push (web/PWA)   = tap to open the message (no inline reply on iPhone web)
Fallback         = email after 15 min unseen (needs-reply), SMS for urgent (phase 2)
Digest           = FYI bundled into the existing 7am morning email/push
```

---

## 3. Speed: capture in 2 taps or fewer, from anywhere

| Where you are | Tap 1 | Tap 2 | Job is chosen by |
|---|---|---|---|
| Job / Customer File (any tab) | Composer is always docked at the bottom of the Activity tab or rail | Type → Send | The page you're on |
| Canvass pin (`LeadModal` / iOS `LeadSheetView`) | "💬 Message" button on the sheet | Type → Send | The pin. It creates a *prospect thread* if no opportunity exists yet. |
| Appointment card (calendar, Today) | 💬 icon on the card | Type → Send | The appointment's opportunity |
| Today list row (ops / owner) | Swipe left → "Message", or long-press | Type → Send | The row's deal |
| **Global + button** (bottom bar on mobile, `N` key on desktop) | + → sheet opens with **job suggestions already ranked** | Pick the top suggestion (pre-selected), type → Send | Suggestions: (1) the job you last opened in the past 30 min, (2) your appointments in the next or last 3 h, (3) the job nearest your GPS location (opt-in, reusing canvass location), (4) your recent threads, (5) search |
| Push notification (iOS app) | Long-press / pull down | Type → Send | The notification's thread |
| **iOS Share Sheet** (from Messages, Photos, Mail) | Share → "ARX" | Job is pre-suggested → Post | Same ranking as the + button |
| Desktop | `N` anywhere, or the composer in the File rail | Enter | Current page, or the ranked picker |

**Voice-to-text**
- **Phase 1:** the 🎤 button focuses the field and opens the keyboard. iPhone keyboard dictation works in any text field, in Safari and in the app, at no cost. Make the button large and hint "tap the mic on your keyboard" [I].
- **Phase 2 (iOS app):** live on-device transcription with `SFSpeechRecognizer`, using a hold-to-talk button like a walkie-talkie.
  - It posts the **transcript as the message** and keeps the **audio clip attached** (play button).
  - Audio is retained for 90 days, so "what did he actually say" can be checked.
  - Transcripts are searchable.
- **Web on Android and desktop:** use the Web Speech API where the browser supports it, and hide the button where it doesn't [I].

**Photos**
- 📷 opens the camera, or the library on long-press.
- Photos are compressed on the device (longest edge 2048 px, JPEG about 0.7) and uploaded in the background. The message posts right away with a placeholder that fills in.
- Several photos go in one message.
- Photos are stored in the existing job files bucket and appear in the File's **Files** tab automatically, tagged `from_thread`. There is no second gallery.

**Speed budgets** (these are acceptance tests, not aspirations)
- Your own message appears in **under 100 ms** (optimistic).
- Others see it in **under 2 s** with the thread open.
- Push lands in **under 5 s at p90**.
- The thread opens from a push in **under 1 s at p90** on LTE (cached shell plus the last 30 messages).

**Offline**
- Every message gets a client-generated UUID (`client_id`) and is written to an outbox first: IndexedDB on the web, and an extension of the `OfflineLeadQueue` pattern on iOS.
- Status shows on the bubble: `Queued (no signal)` → `Sending` → `Sent` → `Seen by 2`.
- **The server upsert on `client_id` makes retries safe**, so a message is never doubled.
- Photos are queued as files and uploaded resumably. The message text never waits on a photo.
- The last 50 threads and their last 100 messages are cached for offline reading.
- A message stuck more than 10 min shows a red "Not sent — tap to retry". Nothing is ever dropped silently.

---

## 4. Reach: delivery where people already are

### 4.1 Channels in priority order

1. **ARX Sales iOS app push (APNs)**
   - This is the primary channel for iPhone users. `lib/push-apns.ts` already works.
   - Add a notification category `THREAD_MESSAGE` with actions: **Reply** (`UNTextInputNotificationAction`), **Done ✓**, **Snooze 1h**.
   - Add `thread-id` to group a job's notifications together on the lock screen.
   - The payload carries `url: /c/{customer}/d/{deal}/activity/m/{messageId}`, and `routeNotification` opens that exact message instead of a tab.
2. **Web push (PWA, Android, desktop Chrome/Edge)**
   - Add VAPID keys, the `web-push` package and a `web_push_subscriptions` table, and send from the same dispatcher.
   - Extend `canvass-sw.js`'s existing `push` / `notificationclick` handlers. **Put the deep-link URL in the notification `tag` too**, because iOS web drops action data (forum workaround [W]).
   - Android Chrome supports action buttons, so "Done" can work there. Inline text reply is a native-app feature only [I].
3. **In-app**: the bell plus the Waiting on you list, live over a Supabase Realtime broadcast (§10.3).
4. **Email fallback** (Nodemailer exists)
   - It is sent when a *needs-reply* message is still unseen after 15 min and the user has no working push device.
   - The subject is "Sam needs a reply · Hall · 123 Sample St", with a single **Open in thread** link.
   - **Reply-by-email is not in v1.** It needs an inbound mail parser (Phase 3, with SMS).
5. **SMS fallback** (Phase 2, needs Twilio)
   - **Urgent only**, plus anyone whose push is broken: the device token was purged as unregistered and they have no web subscription.
   - The text reads: "URGENT from Riley re Hall/123 Sample St: Dumpster blocking neighbor. Open: arx.link/m/AB12".
   - 9 of 12 active users have a phone on file [V].

### 4.2 Reply directly from the notification

- **iOS app:** inline reply posts through `POST /api/threads/{id}/messages` with `source='push_reply'`, `client_id` and `reply_to=messageId`. The reply inherits the parent's audience, and it **resolves** the waiting item.
- **"Done ✓"** resolves the item without a message and posts a small "✓ Andrew acknowledged" receipt line.
- **Web push on iPhone:** you can only tap to open. That is why the rollout requires the iOS app (§12).

### 4.3 Reply-by-text landing back in the thread (decision: later, maybe)

| | Detail |
|---|---|
| How | One Twilio long-code number. Each outbound SMS ends with a short code ("Reply here or open arx.link/m/AB12"). Inbound webhook `POST /api/webhooks/sms`: match `From` to `users.phone_normalized`, then to the **last thread that texted this user** (or a `#AB12` code if present). Post as `source='sms_reply'` with that user as author. |
| Cost [W] | $1.15/mo number. $0.0083 per segment each way plus about $0.003–$0.005 carrier fee. At about 300 texts a month, that's **under $5/mo** [E]. A2P 10DLC brand and campaign registration fees apply (amounts not on Twilio's page). Approval takes days to weeks [I]. |
| Complexity [E] | About 3–4 dev-days, plus registration lead time. You also need STOP/HELP handling, wrong-thread risk when two threads texted the same person (solved by the code), and a phone number on every user. |
| Risk | It gives people a reason to *stay* in SMS. Each reply also shows up in two places in the user's life. |
| Recommendation | **Don't build in v1.** Build SMS **outbound for urgent** first (Phase 2). Add inbound replies only if, after 4 weeks, more than 10% of needs-reply items are answered late by people whose push is off. |

### 4.4 Deep links

- They use the URL scheme from the customer-file spec: `/c/{customerId}/d/{dealId}/activity/m/{messageId}`.
- Opening one scrolls to the message, highlights it for 2 s, and shows the 5 messages above it for context.
- **Login preserves the path** (middleware keeps the pathname only, which is why the ID is in the path).
- A short link `/m/{shortId}` resolves to the long one, for SMS.

---

## 5. Conversation shape

### 5.1 Threads

| Thread kind | Keyed on | Created when | Name |
|---|---|---|---|
| **Deal thread** (the main one) | `opportunity_id`, one per deal | The opportunity is created (inspection booked), or lazily on the first message | "{Last name} · {street}" plus a stage pill |
| **Prospect thread** | `lead_id` with no opportunity yet | The first message from a canvass pin | Re-keyed onto the opportunity when the lead converts. It is the same thread and history carries over. |
| **Direct (1-on-1)** | Two `user_id`s | The first DM | The other person's name |

**Do 1-on-1 messages exist?** **Yes, in Phase 2. Decision proposed.**
- Without them, "can you cover my 4pm?" stays in iMessage, and the job talk follows it there.
- Guard: if a DM names a customer, an address or a job number on your recent list, show a chip: "Move to **Hall · 123 Sample St** thread?" One tap moves it.
- DMs are private to the two people. Owners **cannot** read DMs (state this openly). Job content belongs in job threads.
- No group chats other than job threads in v1. Company-wide announcements are a separate later decision.

### 5.2 Membership

- **Auto-added:**
  - the **setter**: `scheduled_appointments.canvasser_user_id`, or the lead's attributed user
  - the **closer**: the appointment closer or the opportunity owner
  - **inside sales**: whoever was assigned the follow-up
  - the **ops lead**: the job's assigned ops user, or a default ops user from settings
  - **owners**
- Each member has a `reason` (setter, closer, ops, owner, mention, joined) and a **notify level**:

| Member | Default notify level |
|---|---|
| Setter, closer, inside sales, ops lead | **Normal**: push for mentions, replies to you, needs-reply and urgent, plus "active conversation" pushes (§6.2) |
| Owners | **Important**: mentions, needs-reply and urgent only. With 4 owners on every thread, anything louder is noise. |
| Joined voluntarily | Normal |
| Muted (per user, per job) | Urgent and direct mentions only. "Mute" never blocks a direct @mention or an urgent message; that rule is shown in the mute sheet. |

- **@mention pulls someone in.** A mention of a non-member adds them (reason `mention`), but only if they can read the message's audience. The mention list doesn't offer people who can't.
- **Joining:** anyone with access to the deal can tap "Join thread". Leaving is allowed, except for the current setter, closer or ops lead, who can only mute.
- **Role changes** (closer reassigned) add the new person and move the old one to "Important". Nobody is removed silently.

### 5.3 What a message looks like

- Bubble: author initials, the text, any photo or voice clip, and the time.
- An **audience tint** appears only when the audience is not the default for the reader (for example, "Production" shown to the owner), so the default case stays clean.
- Replies are **inline quotes** (iMessage style "reply to"). There are no nested sub-threads, which people don't follow on a phone [I].
- **Reactions:** ✓ (acknowledged), 👍, ❓ only. ✓ counts as "Done" for a needs-reply.
- **Seen by:** under the latest message, "Seen by Andrew, Riley" from member read pointers. Tap to see every member and when each saw it.

---

## 6. Signal vs noise

### 6.1 Human vs system

- System rows are status changes, canvass call logs, "proposal sent", "payment recorded", appointment set and automations.
- They are stored in `activities` as today, with a new `origin='system'`.
- In the thread they are **collapsed into one gray line between human messages**: "⟳ 4 updates · Status → Scheduled, 2 calls, Payment recorded ▸". Tap to expand.
- **Never push a system event** unless a rule explicitly turns it into a human-style alert. For example, "your appointment sold" to the setter stays on its existing notification type.
- **The 4 code paths that write system text as `type='note'`** must set `origin='system'`: `inspection-reports/[id]/send`, `contracts/create`, `webhooks/leads` and `opportunities/[id]/design-pdf`. Backfill existing rows by pattern, or treat `user_id IS NULL` as system.

### 6.2 Three levels, mostly set automatically

| Level | How it gets set | What happens |
|---|---|---|
| **FYI** (default) | Anything not below | No push except to people @mentioned, people replied-to, and **active-conversation** members (you posted in this thread within the last 2 h, like being "in" the group text). Everyone else gets a badge on the thread and a line in the morning digest. |
| **Needs reply** | **Auto-set** when the message @mentions someone and ends with a "?" or a question word, or when it is a reply-to-you with a "?". Can be toggled manually, and the sender sees the chip before sending ("Needs reply from Andrew"). | Push to the mentioned people. Creates a **Waiting on you** item per person. Escalates by email at 15 min unseen if they have no push device. **Resolves** when that person replies in the thread, taps ✓/Done, or turns it into a task. |
| **Urgent** | **Manual only**: the "!" button, with a confirm line "This will buzz {names} even in quiet hours". Allowed for everyone, rate-limited to 3 per user per day. | Push with sound, ignoring quiet hours and mute. SMS at 5 min unseen (Phase 2). Shown red at the top of Waiting on you. Weekly report of urgent use per person, to catch overuse. |

### 6.3 Waiting on you (the inbox)

- **One list, sorted:** urgent first, then needs-reply (oldest first), then tasks due today or overdue, then "mentions (FYI)".
- **Each row** shows who and which job, a one-line message preview, its age ("2h"), and inline **Reply / Done / Snooze**.
- **It empties as you work.** Resolved items move to a "Done today" fold.
- **It is the home of the bell.** The bell count = the Waiting on you count, not all notifications. "Everything" is a secondary tab.
- On the iOS app, the badge = the Waiting on you count.

### 6.4 Quiet hours, mute, digest

| Setting | Default |
|---|---|
| Quiet hours | 9pm–7am local time, all day Sunday. During quiet hours only urgent pushes go out; everything else waits for the digest at 7am. |
| Digest | Fold FYI items into the **existing morning email/push** (`lib/morning-update-email.ts` / `email_blast_sends` cron) instead of building a second email: "Overnight: 5 updates on 3 jobs · 1 needs your reply". It is sent only if there is something unread. |
| Per-job mute | Mute for 1 day, 1 week, or until the stage changes. Other members **can see you muted** (AccuLynx does this [W]), so nobody assumes you saw it. |

People can change these settings, but most never will [I].

---

## 7. Audience and permissions

### 7.1 Audiences

- Use the same audiences as the customer-file spec. Crew is out of scope here.
- Add one automatic flag, `restricted_pricing`.

| Audience | Who reads | Used for |
|---|---|---|
| **Team** | Everyone with access to the deal, including the setter | General job talk: "Homeowner home after 3", "Gate code changed" |
| **Sales** | Sales side (setter on own deals, closer, inside sales, sales managers, owners). Ops reads it behind the "Sales history" chip. | Selling chatter |
| **Production** | Ops, owners, the deal's closer (read and write), production manager. **Never setters, canvassers or inside sales.** | Build details, scheduling, materials, crew issues |
| `restricted_pricing` = true (flag on any audience) | Hidden from roles barred by the existing `isBarredFromSalesDocAccess` (setters, canvassers) | Prices, discounts, commissions, financing terms |

### 7.2 The audience is picked automatically and never shown as a form field

The composer shows **one chip** with the chosen audience (for example "Production"). Tapping it is allowed but never needed. The default rules, first match wins:

1. **Replying** to a message → the parent's audience. Any `restricted_pricing` flag is inherited too.
2. **Author is a setter, canvasser or inside sales** → **Team**. They can't write Production, and Sales vs Team doesn't matter for them.
3. **Surface = Job tab, ops board, Today-ops row** → **Production**.
4. **Surface = Sales tab, appointment card, calendar** → **Team** before the deal is sold, **Sales** if the author is a closer and the deal is in proposal or follow-up.
5. **Global +, share sheet, push reply with no parent** → the last audience *this user* used in *this thread*, otherwise by role: ops → Production, closer → Team, owner → Team.

**Pricing guard (automatic)**
- A check runs on the client and again on the server for things like `$1,234`, "price", "discount", "% off", "commission", "financing", "per square" and "sq @".
- If it matches and the audience includes someone barred from pricing, the composer shows an inline line instead of a modal:
  - "Looks like pricing. **Jordan (setter) won't see this.**"
  - Buttons: **[OK]** (default, sets `restricted_pricing`) or **[Let setters see it]**.
- The safe choice is the default, and one tap overrides it. Setting the flag doesn't change the audience, so the closer still gets it.

**The composer always says who will see a message:** "Visible to Riley, Sam, owners", in small text under the chip. No guessing.

### 7.3 Permission table (R = read, W = write, — = never)

| Role | Team | Sales | Production | Pricing-flagged | Pin | Edit own | Delete own | Delete others | Mark urgent | DMs |
|---|---|---|---|---|---|---|---|---|---|---|
| Setter / canvasser | R/W (own deals) | R/W (own deals) | — | — | — | yes | 15 min | — | yes (rate-limited) | yes |
| Inside sales / call center | R/W (assigned) | R/W (assigned) | — | per sales-doc access | — | yes | 15 min | — | yes | yes |
| Closer / sales rep | R/W own deals | R/W own deals | R/W own deals | R/W | own | yes | 15 min | — | yes | yes |
| Sales manager | R/W team's deals | R/W | R | R/W | yes | yes | 15 min | hide in own team's threads | yes | yes |
| Operations | R/W | R (chip) | R/W | R/W | yes | yes | 15 min | — | yes | yes |
| Owner / admin | R/W | R/W | R/W | R/W | yes | yes | any time (soft) | soft-hide (audited) | yes | yes; **cannot read others' DMs** |

### 7.4 Enforcement

- **One write path:** `lib/threads/post-message.ts` → `postMessage(viewer, threadId, draft)`. It computes the audience, the pricing flag, mentions (by **user ID** from the picker, never by fuzzy name match), priority and recipients, all on the server. The client's chip is only a request.
- **One read path:** `lib/threads/get-thread.ts`, shared with the customer-file `getTimeline`.
  - Do not create a second timeline reader. The thread *is* the Activity tab.
  - Every service-client read goes through `message_visible(viewer, activity)`.
- **RLS:**
  - A policy on `activities` using `message_visible()` (audience, `restricted_pricing`, deal access).
  - DMs are visible only to `thread_members`.
  - Fix the `notifications` SELECT policy to `recipient_user_id = auth.uid()`.
- **Push payloads never contain more than the recipient may see.** Pricing-flagged text is never put in an SMS or email body; it says "Sam sent a message about pricing — open to read". Lock-screen previews of Production text only go to people who can read Production.
- **Tests:** a Jest matrix of role × audience × pricing flag × channel (in-app, push, email, SMS, search, digest). The nav/RBAC history says this will regress without tests.

---

## 8. Trust

| Feature | Rule |
|---|---|
| **Edit** | Allowed any time by the author. Shows "edited"; tapping it shows the full history (`activity_edits`). Edits within 2 min are silent (typo fixes); later edits re-notify nobody but mark the bubble. |
| **Delete** | The author can delete within 15 min, leaving a tombstone: "Message removed by Sam". After 15 min only owners/admins can hide a message, and it is audited. **Nothing is ever hard-deleted** (same principle as contracts). Admins can see removed text in an audit view. |
| **Read receipts** | Always on for internal threads. "Seen by" comes from `thread_members.last_read_at`. No opting out, because the whole point is knowing you were heard. |
| **Typing indicator** | Phase 2 nice-to-have, using a Realtime broadcast only (nothing stored). |
| **Search** | A global search box (Cmd-K and a mobile search tab) over all threads you can read. It uses a `pg_trgm` GIN index on `activities.body` and transcripts, and filters by job, person, date, has-photo, needs-reply. Results open at the message. Search **uses the same visibility function**, which is tested. |
| **Pinned critical info** | Customer-level alerts (max 3, from the customer-file spec): gate code, dog, tenant, "do not text after 6pm". Pin from any message by long-press → "Pin to job". The audience still applies. Optional expiry: "until job complete". The pin bar shows at the top of the thread **and** on the push deep link. |
| **Export** | Thread → PDF or text (for disputes and insurance). Owners only. |

---

## 9. Turning messages into action

- **Make task** (long-press → "Make task", or swipe):
  - The assignee defaults to the mentioned person, or to you.
  - The due date defaults to the next business day at 9am. One-tap chips: Today 5pm, Tomorrow, Next Mon.
  - The title defaults to the message's first 80 characters.
  - It shows in the assignee's Waiting on you.
  - Completing it posts a system line "✓ Riley completed: Order drip edge" in the thread.
- **Remind me:** a personal follow-up on any message ("Remind me tomorrow 8am"). It is a task assigned to yourself and shows in Waiting on you on time.
- **Add to job checklist (ops):** if the job uses the workflow steps from settings (`job_workflows`), add the message as a checklist item on the job sheet. Otherwise create a task of kind `checklist` tied to `production_job_id`. Don't build a second checklist system [I: confirm what job_workflows holds today].
- **Needs reply becomes a task automatically** if it is unresolved for 24 h. The task goes to the asker, so they chase it, not the system.
- **Follow-up date link:** if a closer writes "follow up Friday" in a Sales message, offer a chip "Set follow-up Fri?". It writes the existing `opportunities.follow_up_at`; it doesn't create a new field.

---

## 10. Data model (all additive and nullable)

The design builds on `activities` as the single message store. The customer-file spec already extends it, so there is no second notes table. Only things that are genuinely new get new tables.

```sql
-- 10.1 Threads and members ------------------------------------------------------
create table threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('deal','prospect','direct')),
  opportunity_id uuid null references opportunities(id),
  lead_id uuid null references leads(id),
  customer_id uuid null references customers(id),
  production_job_id uuid null references production_jobs(id),
  title text null,                         -- cached "Hall · 123 Sample St"
  last_message_at timestamptz null,
  archived_at timestamptz null,            -- auto when job paid + 90 days; still searchable
  created_at timestamptz not null default now()
);
create unique index threads_deal_uq     on threads(opportunity_id) where kind = 'deal';
create unique index threads_prospect_uq on threads(lead_id) where kind = 'prospect';
create index on threads(org_id, last_message_at desc);

create table thread_members (
  thread_id uuid not null references threads(id),
  user_id uuid not null references users(id),
  org_id uuid not null,
  reason text null,                        -- setter|closer|inside_sales|ops|owner|mention|joined|dm
  notify_level text null,                  -- normal|important|muted (null = role default)
  muted_until timestamptz null,
  last_read_at timestamptz null,           -- drives "Seen by" and unread counts
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  primary key (thread_id, user_id)
);
create index on thread_members(user_id, thread_id);

-- 10.2 Messages = activities (extend, don't duplicate) ---------------------------
alter table activities
  add column thread_id uuid null references threads(id),
  add column origin text null,               -- 'human'|'system'; null = legacy (classified in backfill)
  add column audience text null,             -- team|sales|production (crew reserved)
  add column restricted_pricing boolean null,
  add column priority text null,             -- fyi|needs_reply|urgent
  add column reply_to_id uuid null references activities(id),
  add column client_id uuid null,            -- offline idempotency
  add column source text null,               -- web|ios|push_reply|share_ext|email_reply|sms_reply|import
  add column attachments jsonb null,         -- [{file_id, kind:'photo'|'audio', w,h, duration}]
  add column transcript text null,           -- voice messages
  add column mentioned_user_ids uuid[] null,
  add column edited_at timestamptz null,
  add column deleted_at timestamptz null,
  add column deleted_by uuid null,
  add column legacy_ref jsonb null,          -- {table, column, row_id} for migrated notes
  add column pinned_at timestamptz null, add column pinned_by uuid null,       -- (from customer-file spec)
  add column pin_scope text null, add column pin_expires_at timestamptz null;  -- (from customer-file spec)
create unique index activities_client_id_uq on activities(client_id) where client_id is not null;
create index on activities(thread_id, created_at desc);
create index activities_body_trgm on activities using gin (body gin_trgm_ops);

create table activity_edits (
  id bigserial primary key,
  activity_id uuid not null references activities(id),
  previous_body text not null,
  edited_by uuid not null, edited_at timestamptz not null default now()
);

-- 10.3 Notifications: extend the existing table, make it the inbox ---------------
alter table notifications
  add column thread_id uuid null references threads(id),
  add column activity_id uuid null references activities(id),
  add column priority text null,             -- fyi|needs_reply|urgent
  add column resolved_at timestamptz null,   -- Waiting-on-you item cleared
  add column resolution text null,           -- replied|done|task|expired|snoozed
  add column snoozed_until timestamptz null;
create index on notifications(recipient_user_id, resolved_at, priority);

create table notification_deliveries (
  id bigserial primary key,
  notification_id uuid not null references notifications(id),
  channel text not null,                     -- apns|webpush|email|sms|digest
  status text not null,                      -- queued|sent|failed|suppressed_quiet|suppressed_mute
  attempt int not null default 1,
  sent_at timestamptz null, opened_at timestamptz null, error text null
);

create table web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id), org_id uuid not null,
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text null, created_at timestamptz default now(),
  last_seen_at timestamptz null, failed_at timestamptz null
);

create table user_notification_prefs (
  user_id uuid primary key references users(id),
  quiet_start time null, quiet_end time null, quiet_sunday boolean null,  -- null = org default
  digest_enabled boolean null, email_fallback boolean null, sms_fallback boolean null
);

-- 10.4 Tasks (no tasks table exists today [V]) -----------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  thread_id uuid null references threads(id),
  source_activity_id uuid null references activities(id),
  production_job_id uuid null references production_jobs(id),
  kind text not null default 'task',         -- task|reminder|checklist
  title text not null,
  assignee_user_id uuid not null references users(id),
  created_by uuid not null references users(id),
  due_at timestamptz null,
  completed_at timestamptz null, completed_by uuid null,
  created_at timestamptz not null default now()
);
create index on tasks(assignee_user_id, completed_at, due_at);

-- 10.5 Visibility (one function, used by RLS and mirrored in lib/threads) --------
create function message_visible(p_activity activities) returns boolean ...;
-- + RLS policy on activities using it; notifications SELECT → recipient only.
```

**Live updates.**
- Today no Supabase Realtime publication exists [V].
- Use a **Realtime broadcast** per thread and per user. The payload carries **only IDs** (`{thread_id, activity_id}`), and the client then fetches through the API. Message text never crosses Realtime, so audience rules stay on the server.
- This replaces the 10-second SSE polling for threads. Retire `notifications/stream`'s poll once the bell is on broadcast.

---

## 11. Notification rules table

The dispatcher is `lib/threads/dispatch.ts`, one function. It decides per recipient: **in-app (always)**, then the first working push device (iOS app, then web push), then the fallback.

| Event | Who | In-app | Push | Quiet hours | Muted | Fallback if no push or unseen | Waiting on you |
|---|---|---|---|---|---|---|---|
| Human message, FYI | Thread members (normal) | badge | **no** | — | — | digest at 7am | no |
| Human message, FYI, you posted in this thread in the last 2 h | That member | badge | **yes** (grouped by thread) | held → digest | no push | — | no |
| Reply to *your* message | Original author | yes | yes | held → digest | push still sent | email 30 min if unseen and no device | only if it needs a reply |
| **@mention** (FYI) | Mentioned person | yes | yes | held → 7am push | **still sent** | email 30 min | yes ("mention") until seen |
| **Needs reply** | Mentioned / asked person | yes | yes, with sound | held → 7am push (top of digest) | still sent | **email at 15 min** unseen | **yes, until replied, Done or task** |
| **Urgent** | Mentioned, or all normal members if none mentioned | yes | yes, with sound, **time-sensitive** interruption level on iOS | **bypassed** | **bypassed** | **SMS at 5 min** unseen (Phase 2), then a phone-call prompt to the sender at 15 min ("Still unseen — call Andrew?") | yes, red, top |
| DM | Recipient | yes | yes | held → 7am | per-DM mute | email 30 min | needs-reply only |
| Task assigned | Assignee | yes | yes | held | n/a | email at due time if not done | yes |
| Task due or overdue | Assignee | yes | at due time | held → 7am | n/a | in digest | yes |
| Needs reply unresolved for 24 h | Asker | yes | one push | held | n/a | — | becomes a task for the asker |
| System event (status, call, payment) | — | timeline only | **never** (existing notification types like appointment-assigned are unchanged) | — | — | — | no |
| Joined or added to a thread | New member | yes | no | — | — | — | no |

**Hard limits**
- At most **1 push per thread per 2 minutes per person**; extra messages are bundled into the next one ("3 new in Hall · 123 Sample St").
- At most **20 non-urgent pushes per person per day**. Beyond that, they go to the digest and a weekly report flags the noisy thread.
- Invalid tokens are purged: this already happens for APNs, and web push does the same on 404/410.

---

## 12. Migration: 11 places into one timeline

**Principles**
- **Copy, never move.** Old columns and tables stay exactly as they are (the additive rule).
- Every migrated row carries `legacy_ref`, so it is traceable and reversible.
- **Dry-run counts first**, and the migration needs Nathan's sign-off. It is a data write.

| Source | Rows [V] | Becomes | Notes |
|---|---|---|---|
| `activities` type `note` (human) | about 180 | Same rows: set `thread_id`, `origin='human'`, audience by the customer-file legacy rule (setter/canvasser rows on lead/opportunity → Sales, else Team) | No copy needed. They already live in `activities`. |
| `activities` type `note` (system text) | about 90 | `origin='system'` by pattern or `user_id is null` | Collapsed in the thread |
| `activities` other types (call, status…) | about 3,900 | `origin='system'` | Collapsed |
| `production_job_notes` | 104 | Copied into `activities` with `audience='production'` (or `crew` if `share_with_sub`), `source='import'`, the original author and time, `legacy_ref`. Mentions are parsed into `mentioned_user_ids` **only** where there is an exact full-name match. | Then the job page's notes card reads from the thread. **Stop writing new rows** to `production_job_notes` (route redirects to `postMessage`). |
| `work_order_comments` | 0 | — | Route switched to `postMessage` |
| `opportunities.inspection_notes` (158), `.notes` (95) | 253 | One "📋 Note from the old opportunity page" message per non-empty field, audience Sales, timestamped `updated_at` | Field becomes read-only on the old page with "Moved to thread ▸" |
| `projects.notes` (42), `.ops_notes` (29), `production_jobs.internal_notes` (31) | 102 | Same, audience Production | `ops_notes` / `internal_notes` that look like standing instructions are offered to ops as a **one-tap "Pin this?"** prompt on first open |
| `special_instructions` | 3 | Pinned Production message | |
| `leads.notes` (31) | 31 | Message on the prospect or deal thread, audience Team | |
| `leads.canvass_notes` | 7,223 | **Stays on the pin.** For the about 400 leads with an opportunity, it is shown as the first item in the deal thread, "🏠 Door note (from canvass)", read live from the column, not copied. | 18k pins must not each get a thread. The iOS app and canvass keep writing this field; it is a pin attribute, not a conversation. |

**Free-text fields after migration**
- They are hidden from edit forms. Old pages show them read-only for 60 days with a "moved to thread" link.
- **Any API writer still setting them** (iOS app, import scripts) keeps working. A nightly job appends new non-empty changes to the thread as "📋 Updated note (from {field})", so nothing written anywhere is lost during the overlap.
- Remove that bridge once logs show 30 days without writes.

---

## 13. Adoption plan: making the team stop texting

### 13.1 The real lever is behavior, not features

1. **The owners' rule, starting in week 2.** Owners answer job questions **only in the job thread**. When a job text arrives, the owner replies with one canned line ("Put it in the Hall thread, I'll answer there") and answers it there.
   - It is the only rule, and it only works if all four owners hold it.
   - Decision needed from Nathan, Andrew, Steve and Cam (new partner).
2. **Make the right thing the easiest thing:**
   - **iOS Share extension: "Share to ARX".** Long-press a text or photo in iMessage → Share → ARX → the job is pre-suggested → Post. This takes the edge off the transition, because a text you got can land in the thread in about 3 taps.
   - **"Text → thread" in reverse:** when someone texts the owner a photo, the owner shares it into the thread and replies there. The sender sees the reply as a push.
   - **The canned SMS reply** includes the thread's short link, so the sender lands right in it.
3. **The Wednesday 7:30 owners meeting** reviews the 4 numbers in §13.3 for the first 6 weeks.

### 13.2 First-week rollout

| Day | What happens |
|---|---|
| Before launch | Phase 0 and 1 shipped behind a flag. The ARX Sales app is on **every** user's iPhone (TestFlight or App Store) with push allowed. Web push is enabled for desktop and Android. Migration has been dry-run and applied. |
| Mon | 15-min stand-up demo: open a job, send, voice, photo, Waiting on you, reply from the lock screen. **Each person sends a test message and replies to one from the lock screen before leaving the room.** A push health check page (`/settings/notifications`) shows green or red per device. |
| Mon–Fri | Owners post every job update they would have texted into threads, so there is content to react to. Each owner asks at least 2 needs-reply questions a day to make the loop real. |
| Wed | Owners meeting: review the push-enabled share, response time, and any "I missed it" stories. Fix the top issue the same week. |
| Fri | 3-question pulse: "How many job texts did you send this week? What did you text instead of thread? What broke?" |
| Week 2 | The owners' rule starts. Old group texts get a pinned last message: "Moving to CRM threads — reply there." |
| Weeks 3–4 | Turn on the digest and SMS-urgent (Phase 2). Remove the bell's old "all notifications" default. |

### 13.3 Measures of success

| Metric | How measured | Target by week 4 [E] |
|---|---|---|
| **Share of job conversations in the CRM** | Weekly self-report (texts sent about jobs), plus deals with ≥1 human message per active deal-week | ≥80% self-reported. ≥70% of active deals with a human message each week. |
| **Needs-reply median response time** | `notifications.created_at → resolved_at`, business hours | **< 30 min** (today's bell: 175 h median to read [V]) |
| **Push reach** | Active users with a healthy device (APNs or web push, seen in 7 d) | **100%** of active users |
| **Push → open** | `notification_deliveries.opened_at` within 15 min | ≥60% for needs-reply |
| **Unresolved needs-reply over 24 h** | Count per week | ≤2 |
| **Messages per active user per week** | Human `activities` with `origin='human'` | Up from about 0.3 to ≥10 |
| **Noise check** | Non-urgent pushes per user per day; mute rate per thread | Median ≤8 a day; mute rate <10% |
| **Speed** | Client timing beacons: thread open p90, send-to-visible p90 | < 1 s and < 2 s |

Also add the minimal `ui_events` telemetry that `desire-paths.md` §9 proposed, limited to thread opens and message sends.

---

## 14. Failure modes that would kill adoption, and how each is prevented

| # | Failure | How it kills adoption | Prevention |
|---|---|---|---|
| 1 | **Missed notification** | One missed "where's the dumpster?" and people go back to texting | Native APNs with sound for needs-reply. A device health page plus a daily self-check: the server sends a silent push and flags devices that don't confirm within 24 h [I]. Email at 15 min and SMS for urgent. The sender sees **"Delivered / Seen"** state, so they know whether to call. Weekly report of deliveries that failed. |
| 2 | **Push opens to the wrong place** | "It opened the app, not the message" | Exact deep links with tested routing. `routeNotification` handles `url`. Web uses `tag` = URL. An e2e test for every notification type. |
| 3 | **Slow load** | Group texts open instantly | Cached shell plus the last 30 messages. Paginated older history. Optimistic send. `(thread_id, created_at)` index. Budgets enforced in CI (§3). |
| 4 | **Message in the wrong audience** (setter sees pricing or production) | Trust is lost and owners go back to private texts | Automatic audience. Pricing guard. "Visible to …" line. Server-side `postMessage` plus RLS. Role × audience test matrix. Lock-screen preview filtered per recipient. Ops/owner can re-classify, which is logged. |
| 5 | **Too many pings** | People mute the app, then miss what matters | FYI never pushes. Owners on "important". Bundling (1 per thread per 2 min). Daily cap. Quiet hours. Digest. Weekly noise report. |
| 6 | **Can't find an old message** | "I know someone said the color…" so they ask again by text | Global search (trigram) including transcripts. Pins. Filters. Search results open in context. |
| 7 | **Flaky offline** | One lost message on a roof and the trust is gone | Outbox with `client_id`. Visible queued state. Never-silent failure. Photos decoupled from text. Offline read cache. Tested in airplane mode as a release gate. |
| 8 | **No reply from the lock screen on iPhone (web only)** | It's slower than iMessage | Require the native app for iPhone users. Web push is for desktop and Android. |
| 9 | **Owners keep answering texts** | The team learns texting still works | The owners' rule (§13.1), canned redirect reply, share extension, weekly review. |
| 10 | **Old notes "disappeared"** | "Where did the ops notes go?" | Copy, don't move. Read-only old fields for 60 days with a link. Bridge job for writers. `legacy_ref`. |
| 11 | **Waiting on you fills with junk** | It gets ignored like today's bell | Only needs-reply, urgent, tasks and mentions go there. Auto-resolve on reply. 24 h items convert to a task for the asker. One tap to clear. |
| 12 | **Urgent overuse** | Urgent stops meaning urgent | Manual only. 3 per day limit. Confirm line naming who gets buzzed. Weekly per-person urgent count at the owners meeting. |
| 13 | **New member can't see context** | They ask what the history is in a text | All history is visible on join (within audience). Pins at the top. "Catch me up" summary later (Phase 3, optional AI). |
| 14 | **Security leak through notifications** | Same as #4 | Fix `notifications` RLS to recipient-only (Phase 0). Pricing never goes in SMS or email bodies. |

---

## 15. Build phases (rough estimates, one developer with AI assistance) [E]

| Phase | Scope | Estimate [E] |
|---|---|---|
| **0. Safety first** | `notifications` SELECT RLS → recipient-only. `message_visible()` plus `activities` audience RLS. Replace fuzzy mention matching with ID-only mentions. Stop logging recipient emails. `origin='system'` on the 4 system-note writers. Role × audience tests. | 3–4 dev-days |
| **1. Threads that work** | `threads` / `thread_members`, `activities` columns, `postMessage` / `getThread`. Thread UI on the File's Activity tab and as a standalone mobile screen. Collapsed system events. Composer with auto-audience, pricing guard and "Visible to". Mentions picker. Needs-reply auto-detect. Waiting on you plus bell. Realtime broadcast. **iOS app:** Messages tab, push category with inline Reply / Done / Snooze, deep links, badge. **Web push:** VAPID, subscriptions, service-worker deep link. Email fallback. Migration of `production_job_notes` and free-text fields (dry run, then apply). Feature flag. | **4–5 weeks** |
| **2. Group-text parity** | Offline outbox (web and iOS). Photo messages. Voice: dictation button, then iOS hold-to-talk with transcript and audio. iOS Share extension. Make task / Remind me / checklist. Global + with ranked job suggestions. Quiet hours, mute, digest folded into the morning email. Urgent with SMS (Twilio outbound, A2P registration started in week 1 of Phase 1). DMs with "move to job thread". Edit history and delete rules UI. Search. | **4 weeks** |
| **3. Only if measured need** | Reply-by-text and reply-by-email into threads. Typing indicators. Thread export PDF. "Catch me up" summaries. Role mentions (@ops). Announcements channel. | 2–3 weeks |

These estimates assume the customer-file shell (`/c/[id]/d/[deal]/[tab]`) exists or is built alongside. If not, Phase 1 needs a standalone `/threads/[id]` route first (+3 days [E]), which the File later embeds.

**Mandatory per CLAUDE.md:** every change gets a bug-bot review and a collateral-impact sweep, then `/code-review` and `/security-review`. Collateral hot spots: `activities` readers (39 files, 34 of them service-client), the notifications stream, iOS `PushManager`, `canvass-sw.js` caching (do **not** cache thread pages that embed signed photo URLs, same as `/opportunities/`), and the morning-email cron.

---

## 16. Open decisions

1. **Owners' rule:** will all owners answer job questions only in threads from week 2? (Nathan, Andrew, Steve, Cam.) This is the biggest single factor.
2. **iPhone app for everyone:** is every team member on iPhone, and will they install ARX Sales? If anyone is on Android, web push covers them, without inline reply.
3. **1-on-1 DMs:** recommended **yes** (Phase 2), private from owners. Confirm that owners must not read DMs.
4. **SMS:** approve a Twilio number and A2P registration for urgent fallback (about $5/mo [E])? Reply-by-text stays deferred unless the metrics say otherwise.
5. **Quiet hours default:** 9pm–7am plus Sunday. Does the 14% after-hours work [V] mean owners want needs-reply pushes at night? The proposal: no, urgent only.
6. **Who is the default "ops lead"** on a thread while no `operations`-role user exists? Proposal: a settings field, initially Steve (field) for Production and Andrew (back office) for money questions [I].
7. **Pricing guard strictness:** flag by default (proposed) vs block setters entirely from any message with `$`.
8. **Voice audio retention:** 90 days (proposed) vs forever.
9. **Owner read access to removed messages:** audit view yes (proposed).
10. **Customer-file dependency:** build threads inside the new File shell, or ship a standalone thread screen first (faster, and the File embeds it later)?

---

### Confidence notes

- All counts come from read-only aggregate SQL run 2026-10-21. "System-text notes" were classified by four known body patterns, so the human/system split is approximate.
- iOS web push limits come from vendor documentation and developer-forum reports, not from Apple documentation, and could change with iOS releases. Inline reply via `UNTextInputNotificationAction` is a standard iOS API, but it is not implemented in the app today.
- Twilio prices were taken from its pricing page on 2026-10-21. A2P registration fees were not listed there.
- Estimates are rough and labeled [E]. They assume the existing patterns: `push-apns.ts`, Nodemailer, offline queues.

---
## Owner requirement added 2026-10-21: search that actually works at scale
Threads can get very large, so search is a phase-1 must-have, not phase 2.
- Postgres full-text search (tsvector, generated column + GIN index) over message text, voice-note transcripts, photo captions and pinned items; plus pg_trgm for typos and partial words ("gutt" finds "gutters", misspelled names).
- Scopes: within this job's thread (default when inside a job), across all jobs I can see (global search, Ctrl/Cmd-K and a search icon on mobile).
- Filters: person, audience, date range, has photo, has task, urgent/needs reply.
- Results show the matching snippet highlighted; tapping jumps to that message in its thread with ~5 messages of context above and below, and loads older/newer around it (no scrolling from the top).
- Search respects audience permissions server-side (a setter never gets production/pricing hits, even counts).
- Fast: target < 300 ms for 100k messages; paginate 25 results at a time.
- Tests: typo tolerance, permission filtering, jump-to-message on threads with 5,000+ messages.
