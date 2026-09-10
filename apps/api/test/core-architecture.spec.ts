import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
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
  it('keeps payment orchestration out of domain storage and effects inside the caller transaction', () => {
    const entry = readFileSync(
      resolve(root, 'src/payments/order-finalizer.service.ts'),
      'utf8',
    );
    const file = ts.createSourceFile(
      'finalizer.ts',
      entry,
      ts.ScriptTarget.Latest,
      true,
    );
    const directStores = new Set<string>();
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'tx'
      )
        directStores.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect([...directStores].sort()).toEqual(['auditLog', 'order']);
    const effects = sources(resolve(root, 'src')).filter((path) =>
      path.endsWith('-payment-fulfillment.ts'),
    );
    expect(effects.length).toBeGreaterThan(0);
    for (const path of effects) {
      const source = readFileSync(path, 'utf8');
      const ast = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node))
          expect(node.name.text, relative(root, path)).not.toBe('$transaction');
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          expect(node.moduleSpecifier.text, relative(root, path)).not.toMatch(
            /prisma\.service|payments\/|paid-order-effects/,
          );
        }
        ts.forEachChild(node, inspect);
      };
      inspect(ast);
    }
  });
  it('limits payment effects to their declared database operations and order inputs', () => {
    // These are dependency budgets, not snapshots of function bodies. Broadening
    // a port requires reviewing the business boundary before changing this list.
    const budgets = {
      'venues/fulfillment/venue-payment-fulfillment.ts': {
        order: ['id'],
        stores: { courtBooking: ['updateMany'] },
      },
      'games/registration/game-payment-fulfillment.ts': {
        order: ['id', 'businessType', 'createdAt'],
        stores: { gameRegistration: ['findUnique', 'updateMany'] },
      },
      'events/registration/event-payment-fulfillment.ts': {
        order: ['id', 'businessType'],
        stores: { eventTeam: ['findUnique', 'updateMany'] },
      },
      'training/enrollments/training-payment-fulfillment.ts': {
        order: ['id'],
        stores: {
          trainingEnrollment: ['findUnique', 'count', 'update'],
          trainingSession: ['findMany'],
          trainingAttendance: ['createMany'],
        },
      },
      'memberships/purchases/membership-payment-fulfillment.ts': {
        order: ['parameterSnapshot', 'membership'],
        stores: {
          memberSubscription: [
            'findFirst',
            'findMany',
            'findUniqueOrThrow',
            'update',
          ],
          memberProfile: ['findUnique', 'update'],
          auditLog: ['create'],
        },
      },
      'memberships/purchases/recharge-payment-fulfillment.ts': {
        order: ['id', 'businessType', 'parameterSnapshot', 'memberId', 'title'],
        stores: {
          account: ['findUniqueOrThrow', 'updateMany'],
          accountTransaction: ['findUnique', 'create'],
        },
      },
      'inventory/transactions/goods-payment-fulfillment.ts': {
        order: ['businessType', 'orderNo', 'items'],
        stores: {
          inventoryItem: ['findUnique', 'updateMany'],
          inventoryTransaction: ['findUnique', 'create'],
          inventoryStockBalance: ['findMany', 'updateMany'],
        },
      },
      'members/referrals/referral-payment-fulfillment.ts': {
        order: ['id', 'memberId'],
        stores: {
          user: ['findUnique'],
          order: ['count'],
          systemParameter: ['findFirst'],
          referralReward: ['upsert'],
          auditLog: ['create'],
        },
      },
      'alliance/coupons/coupon-payment-fulfillment.ts': {
        order: ['id', 'consumedCouponCode', 'payableCents'],
        stores: {
          couponCode: ['findUnique', 'updateMany'],
          couponTemplate: ['update'],
        },
      },
    } satisfies Record<
      string,
      { order: string[]; stores: Record<string, string[]> }
    >;
    const config = ts.readConfigFile(
      resolve(root, 'tsconfig.json'),
      ts.sys.readFile,
    );
    const { options } = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      root,
    );
    const program = ts.createProgram(
      Object.keys(budgets).map((path) => resolve(root, 'src', path)),
      options,
    );
    const checker = program.getTypeChecker();
    for (const [path, budget] of Object.entries(budgets)) {
      const file = program.getSourceFile(resolve(root, 'src', path))!;
      for (const node of file.statements) {
        if (
          !ts.isFunctionDeclaration(node) ||
          !node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          )
        )
          continue;
        const input = node.parameters[0];
        const context = checker.getTypeAtLocation(input);
        const fieldType = (type: ts.Type, name: string) =>
          checker.getTypeOfSymbolAtLocation(type.getProperty(name)!, input);
        const allowedKeys = (type: ts.Type, allowed: string[]) => {
          expect(
            type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown),
            `${path}: opaque dependency`,
          ).toBe(0);
          for (const key of type
            .getProperties()
            .map((property) => property.name))
            expect(allowed, `${path}: unexpected dependency ${key}`).toContain(
              key,
            );
        };
        const tx = fieldType(context, 'tx');
        allowedKeys(tx, Object.keys(budget.stores));
        for (const [store, methods] of Object.entries(budget.stores))
          if (tx.getProperty(store)) allowedKeys(fieldType(tx, store), methods);
        const order = fieldType(context, 'order');
        allowedKeys(order, budget.order);
        if (context.getProperty('payment'))
          allowedKeys(fieldType(context, 'payment'), ['id']);
        if (order.getProperty('membership')) {
          const membership = checker.getNonNullableType(
            fieldType(order, 'membership'),
          );
          allowedKeys(membership, ['id', 'memberId', 'product']);
          allowedKeys(fieldType(membership, 'product'), [
            'durationDays',
            'level',
          ]);
        }
        if (order.getProperty('items')) {
          const item = checker.getIndexTypeOfType(
            fieldType(order, 'items'),
            ts.IndexKind.Number,
          )!;
          allowedKeys(item, ['id', 'itemId', 'name', 'quantity']);
        }
      }
    }
  }, 30_000);
  it('keeps the remaining retired services out of production', () => {
    expect(
      existsSync(
        resolve(root, 'src/inventory/inventory-operations.service.ts'),
      ),
    ).toBe(false);
    expect(
      existsSync(resolve(root, 'src/inventory/inventory.service.ts')),
    ).toBe(false);
    expect(
      existsSync(
        resolve(root, 'src/inventory/consignment-settlement.service.ts'),
      ),
    ).toBe(false);
    expect(existsSync(resolve(root, 'src/games/games.service.ts'))).toBe(false);
    expect(existsSync(resolve(root, 'src/members/members.service.ts'))).toBe(
      false,
    );
    expect(existsSync(resolve(root, 'src/venues/venues.service.ts'))).toBe(
      false,
    );
    expect(
      existsSync(resolve(root, 'src/governance/governance.service.ts')),
    ).toBe(false);
    expect(
      existsSync(resolve(root, 'src/memberships/memberships.service.ts')),
    ).toBe(false);
    expect(existsSync(resolve(root, 'src/alliance/alliance.service.ts'))).toBe(
      false,
    );
    expect(
      existsSync(resolve(root, 'src/training/training-trials.service.ts')),
    ).toBe(false);
    expect(existsSync(resolve(root, 'src/orders/orders.service.ts'))).toBe(
      false,
    );
  });

  it('keeps retired aggregate services and controllers out of production', () => {
    for (const domain of ['events', 'training']) {
      for (const layer of ['service', 'controller']) {
        expect(
          existsSync(resolve(root, `src/${domain}/${domain}.${layer}.ts`)),
        ).toBe(false);
      }
    }
    for (const path of sources(resolve(root, 'src'))) {
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const node of file.statements) {
        if (
          (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
          !node.moduleSpecifier ||
          !ts.isStringLiteral(node.moduleSpecifier)
        )
          continue;
        const target = node.moduleSpecifier.text;
        if (target.startsWith('.')) {
          expect(
            relative(resolve(root, 'src'), resolve(dirname(path), target)),
            relative(root, path),
          ).not.toMatch(/^\.\.\/test(?:\/|$)/);
        }
      }
    }
  });

  it('keeps shared order and extracted workflows independent of activity orchestration services', () => {
    const forbidden = new Set(
      [
        'events/events.service.ts',
        'games/games.service.ts',
        'training/training.service.ts',
      ].map((name) => resolve(root, 'src', name)),
    );
    const entries = [
      'inventory/suppliers/inventory-operations-suppliers.service.ts',
      'inventory/locations/inventory-operations-locations.service.ts',
      'inventory/purchasing/inventory-operations-purchasing.service.ts',
      'inventory/stocktaking/inventory-operations-stocktaking.service.ts',
      'inventory/movements/inventory-operations-movements.service.ts',
      'inventory/catalog/inventory-catalog.service.ts',
      'inventory/transactions/inventory-transactions.service.ts',
      'inventory/consignment/ledger/consignment-settlement-ledger.service.ts',
      'inventory/consignment/queries/consignment-settlement-queries.service.ts',
      'inventory/consignment/statements/consignment-settlement-statements.service.ts',
      'inventory/consignment/workflow/consignment-settlement-workflow.service.ts',
      'games/catalog/games-catalog.service.ts',
      'games/hosts/games-hosts.service.ts',
      'games/cancellation/games-cancellation.service.ts',
      'games/registration/games-registration.service.ts',
      'games/completion/games-completion.service.ts',
      'games/rewards/games-rewards.service.ts',
      'members/directory/members-directory.service.ts',
      'members/leads/members-leads.service.ts',
      'members/lead-reporting/members-lead-reporting.service.ts',
      'members/accounts/members-accounts.service.ts',
      'members/referrals/members-referrals.service.ts',
      'venues/availability/venues-availability.service.ts',
      'venues/closures/venues-closures.service.ts',
      'venues/booking/venues-booking.service.ts',
      'venues/fulfillment/venues-fulfillment.service.ts',
      'venues/pricing/venues-pricing.service.ts',
      'governance/users/governance-users.service.ts',
      'governance/risks/governance-risks.service.ts',
      'memberships/products/memberships-products.service.ts',
      'memberships/recharge-plans/memberships-recharge-plans.service.ts',
      'memberships/purchases/memberships-purchases.service.ts',
      'alliance/merchants/alliance-merchants.service.ts',
      'alliance/templates/alliance-templates.service.ts',
      'alliance/coupons/alliance-coupons.service.ts',
      'alliance/settlements/alliance-settlements.service.ts',
      'training/trials/booking/training-trials-booking.service.ts',
      'training/trials/follow-up/training-trials-follow-up.service.ts',
      'orders/queries/orders-queries.service.ts',
      'orders/payments/orders-payments.service.ts',
      'orders/refund-requests/orders-refund-requests.service.ts',
      'orders/refund-review/orders-refund-review.service.ts',
      'orders/pending/orders-pending.service.ts',
      'events/catalog/event-catalog.service.ts',
      'events/catalog/event-cancellation.service.ts',
      'events/invitations/event-invitations.service.ts',
      'events/registration/event-registration.service.ts',
      'events/registration/event-participation.service.ts',
      'events/registration/event-withdrawal.service.ts',
      'events/competition/event-competition.service.ts',
      'events/prizes/event-prizes.service.ts',
      'training/catalog/training-catalog.service.ts',
      'training/students/training-students.service.ts',
      'training/enrollments/training-enrollments.service.ts',
      'training/schedule/training-schedule.service.ts',
      'training/attendance/training-attendance.service.ts',
      'training/consumption/training-consumption.service.ts',
      'training/corrections/training-corrections.service.ts',
      'training/settlements/training-settlements.service.ts',

      'orders/pending/orders-pending.service.ts',
      'orders/payments/orders-payments.commands.ts',
      'orders/refund-requests/orders-refund-requests.commands.ts',
      'orders/refund-review/orders-refund-review.commands.ts',
      'orders/pending-order-resources.ts',
      'orders/refund-resources.ts',
      'payments/wechat-pay.service.ts',
      'events/registration/event-waitlist.ts',
      'games/game-waitlist.ts',
      'events/prizes/event-prizes.ts',
      'events/competition/event-rounds.ts',
      'events/competition/event-scoring.ts',
      'events/competition/event-completion.ts',
      'events/competition/event-standings.ts',
      'events/competition/event-competition-policy.ts',
      'training/settlements/training-settlements.ts',
      'training/corrections/training-consume-corrections.ts',
      'training/training-access.ts',
    ];
    const visited = new Set<string>();
    const violations: string[] = [];
    const visit = (path: string, chain: string[]) => {
      if (forbidden.has(path)) {
        violations.push([...chain, relative(root, path)].join(' -> '));
        return;
      }
      if (visited.has(path) || path.includes('/generated/')) return;
      visited.add(path);
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const node of file.statements) {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
          continue;
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
          continue;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
        if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
          continue;
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.') || !specifier.endsWith('.js')) continue;
        visit(resolve(dirname(path), specifier.replace(/\.js$/, '.ts')), [
          ...chain,
          relative(root, path),
        ]);
      }
    };
    for (const entry of entries) visit(resolve(root, 'src', entry), []);
    expect(violations).toEqual([]);
  });

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
