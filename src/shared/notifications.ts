/**
 * Durable notification port for 10+travel release reminders.
 *
 * - Persists pending notifications in localStorage (survives reload / kill+reopen).
 * - On bootstrap, restores timers for future items; fires overdue immediately.
 * - Uses browser Notification API when permission is granted.
 * - Falls back to in-app handler (register via setNotificationHandler).
 *
 * Native Capacitor LocalNotifications can be wired later without changing the API.
 */

const STORAGE_KEY = 'wiseduty.pendingNotifications.v1'

export interface PendingNotification {
  id: string
  fireAt: number
  title: string
  body: string
  releaseAt?: string
}

type NotifyHandler = (n: PendingNotification) => void

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>()
let onNotify: NotifyHandler | null = null
let bootstrapped = false

function loadPending(): PendingNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingNotification[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePending(list: PendingNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // quota / private mode
  }
}

function removePending(id: string): void {
  savePending(loadPending().filter((n) => n.id !== id))
  const t = activeTimers.get(id)
  if (t) {
    clearTimeout(t)
    activeTimers.delete(id)
  }
}

function deliver(n: PendingNotification): void {
  removePending(n.id)

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(n.title, { body: n.body, tag: n.id })
    } catch {
      // ignore
    }
  }

  onNotify?.(n)
}

function armTimer(n: PendingNotification): void {
  if (activeTimers.has(n.id)) return
  const delay = n.fireAt - Date.now()
  if (delay <= 0) {
    deliver(n)
    return
  }
  // setTimeout max ~24.8 days in some engines; re-arm if farther out
  const chunk = Math.min(delay, 24 * 60 * 60 * 1000)
  const t = setTimeout(() => {
    activeTimers.delete(n.id)
    if (n.fireAt <= Date.now()) deliver(n)
    else armTimer(n)
  }, chunk)
  activeTimers.set(n.id, t)
}

function enqueue(n: PendingNotification): void {
  const list = loadPending().filter((x) => x.id !== n.id)
  list.push(n)
  list.sort((a, b) => a.fireAt - b.fireAt)
  savePending(list)
  armTimer(n)
}

/** Register UI handler for in-app dialog when a notification fires. */
export function setNotificationHandler(handler: NotifyHandler | null): void {
  onNotify = handler
}

/** Call once on app load to restore durable timers from localStorage. */
export function bootstrapNotifications(): void {
  if (bootstrapped) return
  bootstrapped = true
  const now = Date.now()
  for (const n of loadPending()) {
    if (n.fireAt <= now) deliver(n)
    else armTimer(n)
  }
}

export function clearScheduledNotifications(): void {
  activeTimers.forEach((id) => clearTimeout(id))
  activeTimers.clear()
  savePending([])
}

export function listPendingNotifications(): PendingNotification[] {
  return loadPending()
}

async function ensureWebPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const p = await Notification.requestPermission()
    return p === 'granted'
  } catch {
    return false
  }
}

/**
 * Schedule 10+travel release reminders relative to prior FDP release.
 * Returns false if release is already in the past.
 */
export async function scheduleTravelRestReminders(
  releaseAt: Date,
  opts?: {
    /** Return true if user wants reminders. Default: true. */
    askUser?: () => Promise<boolean>
  },
): Promise<{ ok: boolean; hoursSinceRelease?: number }> {
  const now = new Date()
  if (now > releaseAt) {
    return {
      ok: false,
      hoursSinceRelease:
        (now.getTime() - releaseAt.getTime()) / (1000 * 60 * 60),
    }
  }

  const wants = opts?.askUser ? await opts.askUser() : true
  if (!wants) return { ok: true }

  await ensureWebPermission()

  const releaseIso = releaseAt.toISOString()
  const firstAt = releaseAt.getTime() + 30 * 60 * 1000
  const secondAt = firstAt + 30 * 60 * 1000

  enqueue({
    id: `travel-rest-1-${releaseIso}`,
    fireAt: firstAt,
    title: 'WiseDuty · 10+travel',
    body: 'Confirm the new release time with your company (hotel room, key in hand, or established rest location).',
    releaseAt: releaseIso,
  })
  enqueue({
    id: `travel-rest-2-${releaseIso}`,
    fireAt: secondAt,
    title: 'WiseDuty · 10+travel follow-up',
    body: 'Update the release time in the app to reflect the actual time at the rest location.',
    releaseAt: releaseIso,
  })

  return { ok: true }
}
