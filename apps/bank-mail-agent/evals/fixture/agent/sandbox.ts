import { defineSandbox } from 'eve/sandbox'
import { justbash } from 'eve/sandbox/just-bash'

// The fixture never exposes sandbox tools. Pinning the dependency-free backend
// keeps the eval hermetic and avoids touching the developer's VM/container state.
export default defineSandbox({
  backend: justbash(),
  description: 'Hermetic, unused sandbox for deterministic bank-mail evals.',
})
