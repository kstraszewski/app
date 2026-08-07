import { MULTIFORM_MODEL_DEFINITIONS } from "@openexpert/multiform";
import { defineAgent } from "eve";

const model = MULTIFORM_MODEL_DEFINITIONS.agent;

export default defineAgent({
  model: model.gatewayId,
  // Keep the model's published context window explicit for predictable compaction.
  modelContextWindowTokens: model.contextWindowTokens,
});
