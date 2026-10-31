// The subset of js-yaml 4.1.0 that cc-okf uses.
export type Schema = { readonly __schema: unique symbol }
export const CORE_SCHEMA: Schema
export function load(text: string, options?: { schema?: Schema; filename?: string }): unknown
