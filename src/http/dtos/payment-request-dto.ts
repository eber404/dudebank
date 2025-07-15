import { z } from 'zod'

const paymentSchema = z.object({
  correlationId: z.uuid(),
  amount: z.number().positive(),
})

export class PaymentRequestDTO {
  readonly correlationId: string
  readonly amount: number

  private constructor(data: z.output<typeof paymentSchema>) {
    this.correlationId = data.correlationId
    this.amount = data.amount
  }

  static create(input: z.input<typeof paymentSchema>) {
    const validation = paymentSchema.safeParse(input)

    if (!validation.success) {
      throw new Error(validation.error.message)
    }

    return new PaymentRequestDTO(validation.data)

  }
}