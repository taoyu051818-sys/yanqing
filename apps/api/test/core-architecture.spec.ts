import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === 'generated'
      ? []
      : entry.isDirectory()
        ? sources(resolve(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
          ? [resolve(dir, entry.name)]
          : [],
  );
}
function access(
  node: ts.Expression,
): { owner: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node))
    return { owner: node.expression, name: node.name.text };
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return { owner: node.expression, name: node.argumentExpression.text };
}
describe('core architecture regression boundaries', () => {
  it('keeps direct Order status updates inside the transition writer', () => {
    const violations: string[] = [];
    for (const path of sources(resolve(root, 'src'))) {
      if (path === resolve(root, 'src/orders/order-transition.ts')) continue;
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const method = access(node.expression);
          if (
            method &&
            ['update', 'updateMany', 'updateManyAndReturn', 'upsert'].includes(
              method.name,
            ) &&
            access(method.owner)?.name === 'order'
          ) {
            // Literal metadata-only updates are allowed; opaque update arguments
            // and nested status assignments require explicit architectural review.
            const arg = node.arguments[0];
            const data =
              arg && ts.isObjectLiteralExpression(arg)
                ? arg.properties.find(
                    (property) =>
                      property.name?.getText(file) ===
                      (method.name === 'upsert' ? 'update' : 'data'),
                  )
                : undefined;
            const literalData =
              data &&
              ts.isPropertyAssignment(data) &&
              ts.isObjectLiteralExpression(data.initializer);
            if (
              !literalData ||
              /\bstatus\b|\.\.\./.test(data.initializer.getText(file))
            ) {
              violations.push(
                `${relative(root, path)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`,
              );
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(violations).toEqual([]);
  }, 30_000);
  it('includes every database boundary suite in the executable acceptance matrix once', () => {
    const matrix = JSON.parse(
      readFileSync(resolve(root, 'scripts/core-lifecycle-matrix.json'), 'utf8'),
    ) as Record<string, { files: string[] }>;
    const listed = Object.values(matrix).flatMap((group) => group.files);
    const actual = readdirSync(resolve(root, 'test'))
      .filter((name) => name.endsWith('.integration.spec.ts'))
      .map((name) => `test/${name}`);
    expect([...listed].sort()).toEqual(actual.sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
  it.each([
    undefined,
    'postgresql://example.com/live',
    'postgresql://127.0.0.1/production',
  ])(
    'fails closed without an explicitly isolated test database (%s)',
    (url) => {
      const env = {
        ...process.env,
        TEST_DATABASE_URL: url,
        DATABASE_URL: 'postgresql://127.0.0.1/do_not_use',
      };
      if (!url) delete env.TEST_DATABASE_URL;
      const result = spawnSync(
        process.execPath,
        [resolve(root, 'scripts/verify-core-lifecycle.mjs')],
        { env, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('prisma');
    },
  );
});
