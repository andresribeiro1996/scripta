// Public interface of the auth module. Everything else in modules/auth/
// — domain/ (ports, types, errors), adapters/sqlite/ (the concrete
// storage), service.ts, tokens.ts, routes.ts, guard.ts, plugin.ts — is
// this module's private implementation. No other module should import
// from those directly. Import only from here:
//
//   import { registerAuthModule, authGuard } from "../../modules/auth/index.js";
//
// This file, plus Fastify's plugin encapsulation (see plugin.ts) and the
// hexagonal split within the module (domain/ knows nothing about
// adapters/sqlite/, only plugin.ts wires them together), is what keeps
// auth an isolated module rather than just a folder-naming convention:
// code outside modules/auth/ has no path to its database connection, its
// JWT secret, or its route internals — only to the two things exported
// below.

export { authPlugin as registerAuthModule } from "./plugin.js";
export { authGuard } from "./guard.js";
export type { AuthenticatedUser } from "./domain/types.js";
export { EmailInUseError, InvalidCredentialsError } from "./domain/errors.js";
