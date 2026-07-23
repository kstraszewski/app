import { MULTIFORM_MODEL_DEFINITIONS } from "@openexpert/multiform";
import { defineAgent } from "eve";

const model = MULTIFORM_MODEL_DEFINITIONS.agent;

export default defineAgent({
  model: model.gatewayId,
  // Eve 0.22.5 predates this same-day Gateway entry, so compaction needs the published 1,048,576-token window explicitly.
  modelContextWindowTokens: model.contextWindowTokens,
});
