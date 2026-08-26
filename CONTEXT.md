# Theater

Theater provides durable game stages in which an Agent can act under game-specific rules.

## Language

**Theater**:
The composition layer that assembles a Performance, its Director, Characters, Sessions, and Stages, owns the Performance's Main Loop, and manages their durable boundaries. Stages own domain terminal facts; the Director owns Performance completion.
_Avoid_: Scheduler, game rules engine

**Stage**:
A durable game context owned by one Session and named by one Stage ID. Its state can be restored by replaying its recorded Stage Ops.
_Avoid_: State Machine, Match

**Stage ID**:
The stable name used to select one Stage within its owning Session. A Stage is identified by the pair of its owner Session and Stage ID.
_Avoid_: Agent ID, State Machine kind

**Stage Op**:
The durable record of one operation that successfully advanced a Stage. It may carry an observational outcome, but replay is governed by the Op itself; rejected requests and runtime failures are not Stage Ops. Stage Ops are opaque to Characters.
_Avoid_: Tool call, rejected request, transient command

**Performance Session**:
The durable root and public entry point of one Performance branch. It is not driven by an Agent Loop.
_Avoid_: Shared transcript, Agent Session

**Character Session**:
The Agent-backed Session containing one Character's own history within a Performance branch. Its bare Agent receives the Tool list assembled by the Performance. It has no independent preset or fork operation; a Performance Fork derives the required Character Sessions together.
_Avoid_: Performance Session, Shared transcript

**Character Segment**:
One Theater-managed invocation interval in which a Character Agent Loop acts within a Performance. It is a durable orchestration boundary, not a public child resource. Segments have no stable identity: their durable start and end facts are paired by strict stack order and Character. A Segment ends only after its Character work and all Theater-managed settlement are durable; no separate end-reaction phase follows it.
_Avoid_: Character Session, Director invocation

**Theater Main Loop**:
The long-lived Theater-owned main loop for a Performance. At each Director Point it consumes one Director Decision: executing and settling an action before repeating, or completing the Performance.
_Avoid_: Theater Driver, Agent Loop, Director

**Director**:
The reentrant liveness decision construct consulted by the Theater Main Loop at a Director Point. It derives one Director Decision from readable durable state without owning the Main Loop, executing Character work, managing durable orchestration boundaries, or retaining control state across decisions.
_Avoid_: Theater Main Loop, Agent Loop, Character

**Director Decision**:
One liveness result from the Director: perform one Character action or complete the Performance. Completion is a Performance interpretation of domain facts, not a replacement for a Stage's terminal state.
_Avoid_: Stage result, Character turn

**Director Point**:
A durable Performance position at which the Theater Main Loop may ask the Director for the next action. It is any Performance Session prefix whose durable Character Segment stack is empty: initially after the Performance, its Characters, and its Stages are created and flushed, and subsequently after settled Character Segments. At every point all Character Agent Loops are idle and their Sessions are flushed.
_Avoid_: Character turn, arbitrary event boundary

**Instruction**:
Opaque input supplied to a Character for one action and persisted only in that Character's Session. A Performance Session does not copy its content.
_Avoid_: Character history

**Performance Fork**:
A new Performance branch derived from a Director Point in another Performance branch, together with the corresponding Character Sessions. The child Theater Main Loop asks the Director for a fresh decision from that point; forking is exposed only at the Performance level.
_Avoid_: Character Fork, transcript copy

**Gomoku Stage**:
A Stage containing one Gomoku board and enforcing its move, turn, win, and draw rules independently of who controls each color.
_Avoid_: Gomoku participant, Character Session

**Single-Agent Gomoku**:
A non-Theater Gomoku mode in which the User directs black moves and one Agent chooses white moves against the same Gomoku Stage.
_Avoid_: Two-Character Gomoku

**Two-Character Gomoku**:
A Gomoku Performance in which separate black and white Character Sessions take turns against the same Gomoku Stage.
_Avoid_: Single-Agent Gomoku, shared Character Session

**Stone Color**:
The black or white value placed on the Gomoku board. It determines turn order but is not a DSH Character or Agent identity.
_Avoid_: Character, Agent role
