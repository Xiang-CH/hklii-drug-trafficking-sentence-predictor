import { createServerFn } from '@tanstack/react-start'
import { ObjectId } from 'mongodb'
import { db } from '@/lib/db'
import { authMiddleware } from '@/middleware/auth'

export type UserAssignmentCount = {
  userId: string
  count: number
}

export const getUserAssignmentCounts = createServerFn({
  method: 'GET',
})
  .middleware([authMiddleware])
  .handler(async () => {
    const judgementsCollection = db.collection('judgement-html')
    const verifiedCollection = db.collection('verified-features')

    const assignmentCounts = await judgementsCollection
      .aggregate([
        {
          $match: {
            assigned_to: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$assigned_to',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray()

    const verificationCounts = await verifiedCollection
      .aggregate([
        {
          $match: {
            is_verified: true,
          },
        },
        {
          $group: {
            _id: '$verified_by',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray()

    const countMap = new Map<string, number>()

    for (const item of assignmentCounts) {
      const key =
        item._id instanceof ObjectId ? item._id.toHexString() : String(item._id)
      countMap.set(key, item.count)
    }

    for (const item of verificationCounts) {
      const key =
        item._id instanceof ObjectId ? item._id.toHexString() : String(item._id)
      countMap.set(key, (countMap.get(key) || 0) + item.count)
    }

    // Convert Map to a plain object for serialization
    const serialized: Record<
      string,
      { assignment: number; verification: number } | undefined
    > = {}

    countMap.forEach((value, key) => {
      serialized[key] = {
        assignment: value,
        verification:
          verificationCounts.find((v) => {
            const vKey =
              v._id instanceof ObjectId ? v._id.toHexString() : String(v._id)
            return vKey === key
          })?.count || 0,
      }
    })

    return serialized
  })

export type UserAssignmentCounts =
  typeof getUserAssignmentCounts extends () => Promise<infer R> ? R : never

export const getUserAssignmentCount = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((userId: string) => userId)
  .handler(async ({ data: userId }) => {
    const judgementsCollection = db.collection('judgement-html')

    const count = await judgementsCollection.countDocuments({
      assigned_to: userId,
    })

    return count
  })
