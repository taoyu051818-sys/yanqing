import { mockUser } from "./core";
import { getTrainingTrials, getYouthTrainingRules } from "./state";
import {
  type MockTrainingRoute,
  hasRole,
  requireRole,
} from "./training-operations/command-policy.js";
import {
  youthRulePublicView,
  youthRuleManagementView,
  activeMockYouthTrainingRule,
  createYouthRule,
  decideYouthRule,
} from "./training-operations/youth-rules.js";
import { trialView } from "./training-operations/trial-policy.js";
import { reserveTrial } from "./training-operations/trial-booking.js";
import { transitionTrial } from "./training-operations/trial-follow-up.js";
import { updateTrainingProduct } from "./training-operations/course-projections.js";

export function routeMockTrainingOperations(
  method: string,
  url: string,
  data: any = {},
): MockTrainingRoute {
  if (url === "/training/trials/mine" && method === "GET") {
    const userId = mockUser().id;
    return {
      handled: true,
      value: getTrainingTrials()
        .filter(
          (trial) => trial.memberId === userId || trial.guardianId === userId,
        )
        .map((trial) => trialView(trial, false)),
    };
  }
  if (url === "/training/trials" && method === "GET") {
    requireRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const coachOnly =
      hasRole("COACH") && !hasRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: getTrainingTrials()
        .filter(
          (trial) =>
            (!data.status || trial.status === data.status) &&
            (!coachOnly || trial.coachId === mockUser().id),
        )
        .map((trial) => trialView(trial)),
    };
  }
  if (url === "/training/trials" && method === "POST")
    return { handled: true, value: reserveTrial(data) };
  const trialAction = url.match(
    /^\/training\/trials\/([^/]+)\/(check-in|no-show|assess|convert|lost|cancel)$/,
  );
  if (trialAction && method === "POST")
    return {
      handled: true,
      value: transitionTrial(trialAction[1], trialAction[2], data),
    };
  if (url === "/training/youth-rules/active" && method === "GET") {
    const activeRule = activeMockYouthTrainingRule();
    return {
      handled: true,
      value: activeRule ? youthRulePublicView(activeRule) : null,
    };
  }
  if (url === "/training/youth-rules" && method === "GET") {
    requireRole("ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: getYouthTrainingRules()
        .filter((rule) => !data.status || rule.status === data.status)
        .map(youthRuleManagementView),
    };
  }
  if (url === "/training/youth-rules" && method === "POST")
    return { handled: true, value: createYouthRule(data) };
  const ruleDecision = url.match(
    /^\/training\/youth-rules\/([^/]+)\/(publish|reject)$/,
  );
  if (ruleDecision && method === "POST")
    return {
      handled: true,
      value: decideYouthRule(ruleDecision[1], ruleDecision[2] as any, data),
    };
  const productUpdate = url.match(/^\/training\/products\/([^/]+)$/);
  if (productUpdate && method === "PATCH")
    return {
      handled: true,
      value: updateTrainingProduct(productUpdate[1], data),
    };
  return { handled: false };
}
export type { MockTrainingRoute } from "./training-operations/command-policy.js";
export { activeMockYouthTrainingRule } from "./training-operations/youth-rules.js";
export { validateMockYouthProduct } from "./training-operations/youth-rules.js";
export { mockTrainingProductView } from "./training-operations/course-projections.js";
export { decorateMockTrainingEnrollment } from "./training-operations/course-projections.js";
export { mockTrainingSessionView } from "./training-operations/course-projections.js";
