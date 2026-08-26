export const inject = ['theater']

export function apply(ctx) {
  ctx.theater.registerDirector(async () => ({ kind: 'complete' }))
}
