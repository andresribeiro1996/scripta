// Public interface of the socials module — see modules/auth/index.ts for
// why this indirection exists. Nothing outside modules/socials should
// import from domain/, adapters/, service.ts, providerConfig.ts, or
// linkSessions.ts directly.

export { socialsPlugin as registerSocialsModule } from "./plugin.js";
export type { SocialProvider, SocialStatus } from "./domain/types.js";
