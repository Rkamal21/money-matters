import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useNavigate } from 'react-router'

import { useToast } from '@/components/ui/Toast'
import {
  useAccounts,
  useCategories,
  useInvalidateLedger,
  useMerchantRules,
  usePreferences,
  useToday,
} from '@/data/queries'
import { repositories } from '@/data/repositories'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'
import { onAppResume } from '@/platform/app/lifecycle'
import { noticeAmount } from '@/platform/sms/notice'
import { type OpenedDetection, smsCapture } from '@/platform/sms/smsCapture'

import { autoAddDetections, exclusively, undoDetection } from './autoAdd'

/**
 * Mounted once inside the signed-in layout. On Android it:
 *   - adds the clear detections (./autoAdd.ts) when the app opens, comes back
 *     to the foreground, or hears of a new detection while running;
 *   - answers a notification: Undo takes the transaction back out; a tap opens
 *     it — to edit one that was added, to review one that was not;
 *   - hands the receiver what it needs while the app is closed: the rules,
 *     categories, currency and accounts.
 * On the web it does nothing.
 */
export function DetectionListener() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const invalidateLedger = useInvalidateLedger()
  const userId = useUserId()
  const today = useToday()
  const { currency } = usePreferences()
  const accounts = useAccounts().data
  const categories = useCategories().data
  const rules = useMerchantRules().data
  const status = useQuery({
    queryKey: [...queryKeys.smsDetections(), 'status'],
    queryFn: () => smsCapture.status(),
    enabled: smsCapture.isAndroid(),
  }).data

  const ready =
    status?.available === true &&
    accounts !== undefined &&
    categories !== undefined &&
    rules !== undefined &&
    today !== null

  // One pass at a time; a request during a pass runs one more afterwards.
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  const pass = useEffectEvent(async () => {
    if (!ready) return
    const result = await exclusively(() =>
      autoAddDetections(
        { userId, accounts, categories, rules, today, currency, enabled: status.autoAdd },
        { repositories, capture: smsCapture },
      ),
    )
    if (result.added.length > 0 || result.alreadyAdded.length > 0) await invalidateLedger()
    await queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() })
    const live = result.added.filter(({ detection }) => detection.source !== 'import')
    const [only] = live
    if (live.length === 1 && only !== undefined) {
      const { amount, merchant } = only.detection.candidate
      toast.show({
        tone: 'success',
        title: `Added ${noticeAmount(amount)}${merchant === null ? '' : ` · ${merchant}`}`,
        body: 'Found in your messages.',
      })
    } else if (live.length > 1) {
      toast.show({ tone: 'success', title: `Added ${live.length} transactions from your messages` })
    }
  })

  const runPass = useEffectEvent((): Promise<void> => {
    if (running.current !== null) {
      again.current = true
      return running.current
    }
    const current = (async () => {
      do {
        again.current = false
        await pass().catch(() => undefined)
      } while (again.current)
    })().finally(() => {
      running.current = null
    })
    running.current = current
    return current
  })

  const answer = useEffectEvent(async (opened: OpenedDetection) => {
    if (opened.action === 'undo') {
      const { removed } = await undoDetection(opened, userId, { repositories, capture: smsCapture })
      await Promise.all([
        invalidateLedger(),
        queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() }),
      ])
      toast.show({
        tone: 'info',
        title:
          removed === null
            ? 'Removed. Nothing was added.'
            : `Removed ${noticeAmount(removed.amount)}${removed.description === '' ? '' : ` · ${removed.description}`}`,
        ...(removed === null ? {} : { body: 'It will not be added again.' }),
      })
      return
    }
    // A detection opened from its notification is added first, if it is clear.
    await runPass()
    const waiting = (await smsCapture.listPending()).some((detection) => detection.id === opened.id)
    const saved =
      waiting || opened.requestId === null
        ? null
        : await repositories.transactions.findByClientRequestId(userId, opened.requestId)
    if (saved !== null && saved.deletedAt === null) {
      void navigate(`/transactions/${encodeURIComponent(saved.id)}/edit`)
    } else {
      void navigate(`/detected/${encodeURIComponent(opened.id)}`)
    }
  })

  // On launch: the notification that opened the app first (an Undo must not be
  // added before it is undone), then a pass.
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    void smsCapture
      .takeOpenedDetection()
      .then((opened) => (opened === null ? runPass() : answer(opened)))
  }, [ready])

  useEffect(() => {
    if (!smsCapture.isAndroid()) return undefined
    const stopOpened = smsCapture.onDetectionOpened((opened) => void answer(opened))
    const stopAdded = smsCapture.onDetectionAdded(() => void runPass())
    const stopResume = onAppResume(() => {
      // Back from Android settings, a permission or Notification access may have changed.
      void queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() })
      void runPass()
    })
    return () => {
      stopOpened()
      stopAdded()
      stopResume()
    }
  }, [queryClient])

  // Turning automatic adding on adds what is already waiting.
  const autoAdd = status?.autoAdd
  useEffect(() => {
    if (autoAdd === true && started.current) void runPass()
  }, [autoAdd])

  useEffect(() => {
    if (
      !smsCapture.isAndroid() ||
      rules === undefined ||
      categories === undefined ||
      accounts === undefined
    ) {
      return
    }
    void smsCapture.syncContext({ rules, categories, currency, accounts }).catch(() => undefined)
  }, [rules, categories, currency, accounts])

  return null
}
