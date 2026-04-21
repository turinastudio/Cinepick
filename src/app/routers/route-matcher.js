/**
 * Route matching helpers for HTTP request routing.
 */

/**
 * Creates a route matcher that tests a pathname against a regex pattern.
 * @param {RegExp} pattern - The regex pattern to test.
 * @returns {(pathname: string) => RegExpMatchArray | null}
 */
export function createRouteMatcher(pattern) {
  return (pathname) => {
    const match = pathname.match(pattern);
    return match ? { ...match, groups: match.groups || {} } : null;
  };
}

/**
 * Creates a composite router that tries routes in order and returns
 * the first successful match.
 * @param {Array<{ match: RegExp, handler: Function }>} routes
 * @returns {(pathname: string) => { handler: Function, params: RegExpMatchArray | null } | null}
 */
export function createRouter(routes) {
  return (pathname) => {
    for (const route of routes) {
      const match = pathname.match(route.match);
      if (match) {
        return { handler: route.handler, params: match };
      }
    }
    return null;
  };
}
