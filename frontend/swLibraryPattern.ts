export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const libraryCachePattern = (apiBase: string) => new RegExp(`^${escapeRegExp(apiBase)}/library$`)
