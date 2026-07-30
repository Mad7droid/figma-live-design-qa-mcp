import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `src/config.ts` resolves the artifact roots once at module load, which is correct for a
 * server whose environment is fixed at launch. Tests therefore have to redirect those
 * roots before any source module is imported — hence a setup file rather than a beforeAll.
 */
const home = mkdtempSync(join(tmpdir(), 'design-qa-test-'));
process.env.DESIGN_QA_HOME = home;
process.env.DESIGN_QA_REPORT_DIR = join(home, 'reports');
