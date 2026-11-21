export const inject = ['theater']

export function apply(ctx, config) {
  ctx.theater.registerDirector(async (context) => {
    const state = context.readStage(config.stage)
    if (state.isFinished) return { kind: 'complete' }
    const previous = state.lastMove === undefined
      ? 'none; opening move'
      : `${state.lastMove.color} at (${state.lastMove.x}, ${state.lastMove.y})`
    return {
      kind: 'act',
      characterId: state.currentPlayer,
      instruction: [{
        type: 'text',
        text: [
          `Your bound color is ${state.currentPlayer}.`,
          `Previous action: ${previous}.`,
          config.instruction,
        ].join('\n'),
      }],
    }
  })
}
