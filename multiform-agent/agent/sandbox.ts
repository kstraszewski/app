import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// A lightweight deterministic backend is enough for this chat agent and avoids
// requiring Docker or a local VM during OpenExpert development.
export default defineSandbox({
  backend: justbash(),
});
