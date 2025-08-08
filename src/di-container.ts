import { PaymentCommand } from '@/services/payment-command'
import { DatabaseService } from '@/services/database-service'
import { PaymentQuery } from '@/services/payment-query'

export const databaseService = new DatabaseService()
export const paymentCommand = new PaymentCommand(databaseService)
export const paymentQuery = new PaymentQuery(databaseService)
