import { json } from "@remix-run/cloudflare";
import { Params } from "@remix-run/react";
import { ZodObject, ZodRawShape, ZodTypeAny, output, z } from "zod";
import { zx } from "zodix";

export const jsonAsString = <T extends z.ZodTypeAny>(schema?: T) =>
  z
    .string()
    .refine((val) => {
      try {
        const parsed = JSON.parse(val);
        if (schema) {
          return schema.safeParse(parsed).success;
        }
        return true;
      } catch {
        return false;
      }
    })
    .transform((val) => JSON.parse(val) as z.infer<T>);

type ParsedData<T extends ZodRawShape | ZodTypeAny> = T extends ZodTypeAny
  ? output<T>
  : T extends ZodRawShape
    ? output<ZodObject<T>>
    : never;

type Options = {
  /** Custom error message for when the validation fails. */
  message?: string;
  /** Status code for thrown request when validation fails. */
  status?: number;
};

export const zxParseParams = <T extends ZodRawShape | ZodTypeAny>(
  params: Params,
  schema: T,
  options?: Options,
): ParsedData<T> => {
  const parsed = zx.parseParamsSafe(params, schema);
  if (!parsed.success) {
    throw json(
      {
        message: options?.message ?? "Bad Request",
        issues: parsed.error.issues,
      },
      { status: options?.status ?? 400 },
    );
  }
  return parsed.data;
};

export const zxParseQuery = <T extends ZodRawShape | ZodTypeAny>(
  request: Request | URLSearchParams,
  schema: T,
  options?: Options,
): ParsedData<T> => {
  const parsed = zx.parseQuerySafe(request, schema);
  if (!parsed.success) {
    throw json(
      {
        message: options?.message ?? "Bad Request",
        issues: parsed.error.issues,
      },
      { status: options?.status ?? 400 },
    );
  }
  return parsed.data;
};

export const zxParseForm = async <T extends ZodRawShape | ZodTypeAny>(
  request: Request | FormData,
  schema: T,
  options?: Options,
): Promise<ParsedData<T>> => {
  const parsed = await zx.parseFormSafe(request, schema);
  if (!parsed.success) {
    throw json(
      {
        message: options?.message ?? "Bad Request",
        issues: parsed.error.issues,
      },
      { status: options?.status ?? 400 },
    );
  }
  return parsed.data;
};
