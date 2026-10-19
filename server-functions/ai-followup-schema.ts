import {z} from 'zod'
export const recommendationSchema=z.object({nextStep:z.string(),reason:z.string(),subject:z.string(),draft:z.string()})
export type Recommendation=z.infer<typeof recommendationSchema>