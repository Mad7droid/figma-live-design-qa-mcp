import { toHex8 } from '../analyze/color.js';
import { canonicalFontSize, canonicalFontWeight, canonicalRadius } from '../analyze/normalize.js';
import { log } from '../log.js';
import type { Dim } from '../types.js';
import { FigmaForbiddenError, FigmaNotFoundError, figmaGet } from './client.js';

interface VariableValue {
  r?: number; g?: number; b?: number; a?: number;
}

interface Variable {
  id: string;
  name: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  valuesByMode: Record<string, VariableValue | number | string | boolean>;
  scopes?: string[];
}

interface LocalVariablesResponse {
  meta?: {
    variables?: Record<string, Variable>;
    variableCollections?: Record<string, unknown>;
  };
}

export interface VariableSets {
  collections: number;
  values: Partial<Record<Dim, Set<string>>>;
}

/**
 * `GET /v1/files/:key/variables/local` is an Enterprise-plan endpoint requiring the
 * `file_variables:read` scope. Most tokens get a 403. That is not an error condition —
 * it is the common case, and the caller falls back to deriving tokens from bindings.
 */
export async function fetchLocalVariables(fileKey: string): Promise<VariableSets | null> {
  let res: LocalVariablesResponse;
  try {
    res = await figmaGet<LocalVariablesResponse>(`/v1/files/${encodeURIComponent(fileKey)}/variables/local`);
  } catch (err) {
    if (err instanceof FigmaForbiddenError || err instanceof FigmaNotFoundError) {
      log.info('Variables API unavailable (Enterprise-only); deriving tokens from bindings instead.');
      return null;
    }
    throw err;
  }

  const variables = res.meta?.variables;
  if (!variables || Object.keys(variables).length === 0) return null;

  const values: Partial<Record<Dim, Set<string>>> = {};
  const add = (dim: Dim, v: string) => {
    (values[dim] ??= new Set<string>()).add(v);
  };

  for (const variable of Object.values(variables)) {
    for (const modeValue of Object.values(variable.valuesByMode ?? {})) {
      if (variable.resolvedType === 'COLOR' && modeValue && typeof modeValue === 'object') {
        const c = modeValue as VariableValue;
        if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
          add('color', toHex8({
            r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255),
            a: c.a === undefined ? 1 : c.a,
          }));
        }
      } else if (variable.resolvedType === 'FLOAT' && typeof modeValue === 'number') {
        // Scopes tell us what a number is for; without them a float is ambiguous and we
        // must not pour font sizes into the radius set.
        const scopes = variable.scopes ?? [];
        if (scopes.includes('FONT_SIZE')) add('fontSize', canonicalFontSize(modeValue));
        if (scopes.includes('FONT_WEIGHT')) add('fontWeight', canonicalFontWeight(modeValue));
        if (scopes.includes('CORNER_RADIUS')) add('borderRadius', canonicalRadius(modeValue));
      }
    }
  }

  const collections = Object.keys(res.meta?.variableCollections ?? {}).length;
  return Object.keys(values).length > 0 ? { collections, values } : null;
}
