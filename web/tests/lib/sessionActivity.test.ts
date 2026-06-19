import { describe, it, expect } from 'vitest';
import { sessionActivity } from '../../lib/sessionActivity';

describe('sessionActivity', () => {
  it('returns unknown for empty/blank tail', () => {
    expect(sessionActivity('')).toBe('unknown');
    expect(sessionActivity('   \n  ')).toBe('unknown');
  });
  it('detects editing from file writes and patches', () => {
    expect(sessionActivity('✏️  Updated src/app/page.tsx')).toBe('editing');
    expect(sessionActivity('patch applied to lib/utils.ts')).toBe('editing');
  });
  it('detects testing from test runner output', () => {
    expect(sessionActivity('vitest run\n3 passing')).toBe('testing');
    expect(sessionActivity('npm run test')).toBe('testing');
  });
  it('detects building from compile output', () => {
    expect(sessionActivity('npx next build')).toBe('building');
    expect(sessionActivity('tsc --noEmit')).toBe('building');
  });
  it('detects installing from package managers', () => {
    expect(sessionActivity('npm install lodash')).toBe('installing');
    expect(sessionActivity('pnpm add react')).toBe('installing');
  });
  it('detects thinking from reasoning language', () => {
    expect(sessionActivity("Let me think about this...")).toBe('thinking');
    expect(sessionActivity("Planning the next step now")).toBe('thinking');
  });
  it('detects prompted from approval prompts', () => {
    expect(sessionActivity('Do you want to continue? (y/n)')).toBe('prompted');
    expect(sessionActivity('Press Enter to continue')).toBe('prompted');
  });
  it('detects errors and gives them priority over other signals', () => {
    expect(sessionActivity('npm run build\nError: ENOENT cannot find module')).toBe('error');
    expect(sessionActivity('test failed: traceback shown')).toBe('error');
  });
  it('returns unknown when nothing matches', () => {
    expect(sessionActivity('ls -la\nrandom output here')).toBe('unknown');
  });
  it('strips ANSI escapes before matching', () => {
    expect(sessionActivity('\x1b[32mnpm install\x1b[0m express')).toBe('installing');
    expect(sessionActivity('\x1b[31mError: failed\x1b[0m')).toBe('error');
  });
});