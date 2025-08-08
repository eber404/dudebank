import { PaymentCommand } from '@/services/payment-command'
import { DatabaseClient } from '@/services/database-client'

export const databaseClient = new DatabaseClient()
export const paymentCommand = new PaymentCommand(databaseClient)
