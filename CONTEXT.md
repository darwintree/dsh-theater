# Theater

Theater provides durable game stages in which an Agent can act under game-specific rules.

## Language

**Stage**:
A durable game context identified by one Stage ID. Its state can be restored by replaying its recorded Stage Ops.
_Avoid_: State Machine, Match

**Stage ID**:
The stable identity used to select one Stage. The current scope resolves exactly one Stage ID for each Session.
_Avoid_: Agent ID, State Machine kind

**Stage Op**:
The durable record of one operation that successfully advanced a Stage. It may carry an observational outcome, but replay is governed by the Op itself; rejected requests and runtime failures are not Stage Ops.
_Avoid_: Tool call, rejected request, transient command

**Gomoku Stage**:
A Stage in which the User plays black and the Agent plays white. The Agent records both the User's directed moves and its own chosen moves.
_Avoid_: Self-play, Two-Agent match

**Stone Color**:
The black or white value placed on the Gomoku board. It determines turn order but is not a DSH Character or Agent identity.
_Avoid_: Character, Agent role
