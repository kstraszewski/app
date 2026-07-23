import { defaultBackend, defineSandbox } from "eve/sandbox";

// Vercel uses its hosted sandbox in production. Local development falls back
// through Docker or microsandbox to the installed just-bash interpreter.
export default defineSandbox({
  backend: defaultBackend(),
});
