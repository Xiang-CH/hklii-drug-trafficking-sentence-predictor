import { z } from 'zod'

export function getEnumValues<T extends z.ZodEnum<any>>(
  schema: T,
): Array<string> {
  return schema.options
}

export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault
  ) {
    return unwrapSchema((schema as any)._def.innerType)
  }

  if ((schema as any)._def?.type === 'pipe' && (schema as any)._def?.in) {
    return unwrapSchema((schema as any)._def.in)
  }

  return schema
}
