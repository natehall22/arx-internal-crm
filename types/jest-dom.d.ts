// Pulls @testing-library/jest-dom's matcher types (toBeInTheDocument, etc.) into the
// TypeScript program. jest.setup.js already registers these matchers at RUNTIME via
// `import '@testing-library/jest-dom'`, but that's a .js file outside tsconfig's
// type-checked set, so `tsc --noEmit` never saw the ambient augmentation — no prior
// test exercised an RTL matcher, so this went unnoticed until one did.
import '@testing-library/jest-dom'
