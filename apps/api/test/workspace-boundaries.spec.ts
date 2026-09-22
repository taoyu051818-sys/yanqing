import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const root = fileURLToPath(new URL('../../../', import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|vue)$/.test(entry.name) ? [path] : [];
  });
}
function imports(file: string) {
  return Array.from(readFileSync(file, 'utf8').matchAll(/\b(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)/g), match => match[1]);
}
it('production applications do not depend on the archived Next prototype', () => {
  const violations: string[] = [];
  for (const base of ['apps/api/src', 'apps/miniapp/src', 'apps/admin/src', 'packages/shared/src']) {
    for (const file of files(resolve(root, base))) {
      for (const specifier of imports(file)) {
        if (specifier === '@yanqing/legacy-web' || (specifier.startsWith('.') && resolve(dirname(file), specifier).startsWith(resolve(root, 'legacy') + '/'))) violations.push(file + ': ' + specifier);
      }
    }
  }
  expect(violations).toEqual([]);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('next');
});
it('endpoint modules cannot import the aggregate facade or other endpoint domains', () => {
  const directory = resolve(root, 'apps/miniapp/src/services/endpoints');
  const violations: string[] = [];
  for (const file of files(directory)) {
    for (const specifier of imports(file).filter(value => value.startsWith('.'))) {
      const target = resolve(dirname(file), specifier).replace(/\.[jt]s$/, '');
      if (target === resolve(directory, '../api') || target.startsWith(directory + '/')) violations.push(file + ': ' + specifier);
    }
  }
  expect(violations).toEqual([]);
});
