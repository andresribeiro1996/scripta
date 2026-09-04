// Public interface of the tierlists module. Everything else in
// modules/tierlists/ is private implementation — same convention as
// modules/murals/index.ts and modules/arena/index.ts.

export { tierlistsPlugin as registerTierlistsModule } from "./plugin.js";
// Cross-module getter for murals' shared-mural route — see plugin.ts's
// getTierlistsPublicApi for why this opens its own connection instead of
// riding on the plugin's own composition.
export { getTierlistsPublicApi } from "./plugin.js";
export type { TierlistData, TierlistsPublicApi } from "./service.js";
