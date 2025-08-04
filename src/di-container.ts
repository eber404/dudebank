import type { PaymentRequest } from '@/types'

import { PaymentCommand } from '@/services/payment-command'
import { PaymentQuery } from '@/services/payment-query'
import { Queue } from '@/services/queue-service'

export const paymentQueue = new Queue<PaymentRequest>()
export const paymentCommand = new PaymentCommand(paymentQueue)
export const paymentQuery = new PaymentQuery()
