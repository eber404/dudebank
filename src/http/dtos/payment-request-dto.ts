import { z } from 'zod'

const paymentSchema = z.object({
  correlationId: z.uuid(),
  amount: z.number().positive(),
})

type PaymentIn = z.input<typeof paymentSchema>
type PaymentOut = z.output<typeof paymentSchema>


export class PaymentRequestDTO {
  readonly correlationId: string
  readonly amount: number

  private constructor(data: PaymentOut) {
    this.correlationId = data.correlationId
    this.amount = data.amount
  }

  static create(input: PaymentIn) {
    const validation = paymentSchema.safeParse(input)

    if (!validation.success) {
      throw new Error(validation.error.message)
    }

    return new PaymentRequestDTO(validation.data)

  }
}