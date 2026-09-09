import { AllianceController } from '../../src/alliance/alliance.controller.js';
import { GamesController } from '../../src/games/games.controller.js';
import { OrderFinalizerService } from '../../src/payments/order-finalizer.service.js';
import { VenuesController } from '../../src/venues/venues.controller.js';
import { InventoryController } from '../../src/inventory/inventory.controller.js';
import { TrainingTrialsController } from '../../src/training/training-operations.controller.js';
import { ConsignmentSettlementController } from '../../src/inventory/consignment-settlement.controller.js';
import { GovernanceController } from '../../src/governance/governance.controller.js';
import { MembershipsController } from '../../src/memberships/memberships.controller.js';
import { MembersController } from '../../src/members/members.controller.js';
export function createAllianceController(arg0: never) {
  return new AllianceController(arg0, arg0, arg0, arg0);
}
export function createGamesController(arg0: never) {
  return new GamesController(arg0, arg0, arg0, arg0, arg0, arg0);
}
export function createOrderFinalizerService(arg0: never) {
  return new OrderFinalizerService(arg0);
}
export function createVenuesController(arg0: never) {
  return new VenuesController(arg0, arg0, arg0, arg0, arg0);
}
export function createInventoryController(arg0: never, arg1: never) {
  return new InventoryController(arg0, arg0, arg1, arg1, arg1, arg1, arg1);
}
export function createTrainingTrialsController(arg0: never) {
  return new TrainingTrialsController(arg0, arg0);
}
export function createConsignmentSettlementController(arg0: never) {
  return new ConsignmentSettlementController(arg0, arg0, arg0);
}
export function createGovernanceController(arg0: never) {
  return new GovernanceController(arg0, arg0);
}
export function createMembershipsController(arg0: never) {
  return new MembershipsController(arg0, arg0, arg0);
}
export function createMembersController(arg0: never) {
  return new MembersController(arg0, arg0, arg0, arg0, arg0);
}
import { OrdersController } from '../../src/orders/orders.controller.js';
export function createOrdersController(arg0: never) {
  return new OrdersController(arg0, arg0, arg0, arg0, arg0);
}
