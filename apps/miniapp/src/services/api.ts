import { venuesEndpoints } from "./endpoints/venues";
import { sessionEndpoints } from "./endpoints/session";
import { operationsEndpoints } from "./endpoints/operations";
import { ordersEndpoints } from "./endpoints/orders";
import { gamesEndpoints } from "./endpoints/games";
import { eventsEndpoints } from "./endpoints/events";
import { trainingEndpoints } from "./endpoints/training";
import { membersEndpoints } from "./endpoints/members";
import { allianceEndpoints } from "./endpoints/alliance";
import { inventoryEndpoints } from "./endpoints/inventory";

export type {
  WorkItem,
  ReconciliationPeriod,
  CreateVenueBookingCommand,
  VenueClosure,
} from "./api-contracts";

/** Stable entry point; each business domain owns its transport operations. */
export const endpoints = {
  ...venuesEndpoints,
  ...sessionEndpoints,
  ...operationsEndpoints,
  ...ordersEndpoints,
  ...gamesEndpoints,
  ...eventsEndpoints,
  ...trainingEndpoints,
  ...membersEndpoints,
  ...allianceEndpoints,
  ...inventoryEndpoints,
};
