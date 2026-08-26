import { gomokuFactory } from '../../../../theater-gomoku/dist/machine.js'

export const inject = ['theater']

export function apply(ctx, config) {
  for (const character of config.characters) ctx.theater.registerCharacter(character)
  ctx.theater.registerStage({
    stageId: 'board1',
    factory: gomokuFactory,
    config: { boardSize: config.boardSize, winLength: 3 },
  })
  ctx.theater.registerDirector(async () => ({ kind: 'complete' }))
}
