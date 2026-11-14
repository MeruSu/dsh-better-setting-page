/**
 * Host half of `dsh-better-setting-page`.
 *
 * The whole feature is a browser-side stylesheet plus two slot entries, so this
 * half only has to exist for the bundle to resolve and for the Cordis patch to
 * have something to mount. It injects no service and serves no route.
 */
export const name = 'dsh-better-setting-page'
export const inject = []
export function apply(ctx) {
  void ctx
}
