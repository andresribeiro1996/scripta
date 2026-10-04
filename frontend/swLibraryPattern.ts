export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const libraryCachePattern = (apiBase: string) => new RegExp(`^${escapeRegExp(apiBase)}/library$`)

export const libraryFreshPattern = (apiBase: string) => new RegExp(`^${escapeRegExp(apiBase)}/library\\?fresh=1$`)

export const libraryCacheKey = (url: string) => url.split('?')[0]
