# Theater

Theater provides durable multi-Character Performances and optional rule-bearing Stages.

## Language

**Theater**:
The assembly and orchestration module that creates, drives, resumes, and forks Performances. It assembles Characters, a Director, and any declared Stages, owns the Theater Main Loop, and manages the durable boundaries of Character Turns and forks. The Director decides the next action and Performance completion; declared Stages own domain state and rules; Tools may submit Stage Ops.
_Avoid_: Scheduler, game rules engine

**Stage**:
A durable environment owned by a Session and named by a Stage ID. Agents interact with it through Tools. A successful interaction that advances its state produces a Stage Op, and replaying its configuration and Stage Ops restores it. Stage is independent of Theater and may be used directly by ordinary Agents or assembled by Theater.
_Avoid_: State Machine, Match

**State Machine**:
A stateful but deterministic transition model internal to a Stage. Its transitions receive only Stage Ops and are semantically equivalent to the pure function `(current state, Stage Op) -> (next state, result)`. Apart from initialization configuration and Stage Ops, it observes no external system state and is unaware of Agents, Tools, Sessions, Theater, persistence, or the runtime environment. Reads only observe its current state and do not cause transitions.
_Avoid_: Stage

**Stage Op**:
A canonical input that drives one deterministic transition of a Stage's State Machine. Given the same current state and Stage Op, the State Machine must produce the same next state. Accepted Stage Ops are persisted in order and replayed from the initial configuration to restore the Stage. A Tool translates an Agent interaction into a candidate Stage Op; a rejected candidate causes no transition and is not persisted as a Stage Op. Stage Ops are opaque to Characters.
_Avoid_: Tool call, rejected request, transient command

**Performance / Performance Session**:
A Performance is a special DSH Session that is not driven by an Agent Loop. `Performance` is the product term; `Performance Session` is the full term when emphasizing its Session identity, persistence, or fork behavior.
_Avoid_: Shared transcript, Agent Session

**Performance Preset**:
A DSH Preset that assembles a Performance by declaring its Characters, Director, and zero or more Stages.

**Stage-free Performance**:
A Performance whose durable Character Turns and Performance ordering contain all facts needed for its Director decisions. It declares no Stage.
_Avoid_: Synthetic Stage, stateless Stage

**Character**:
An Agent scheduled within a Performance. That Agent's Session is called a Character Session.

**Character Session**:
The Session of a Character. It stores that Character's Agent history, is created, resumed, and forked with the Performance, and has no independent fork semantics.
_Avoid_: Performance Session, Shared transcript

**Character Turn**:
One ordinary DSH Agent Turn executed by a Character and managed by Theater. A top-level Character Turn is triggered by a Director `act` Decision and settles at the next Director Point; a Nested Character Turn is triggered within another Character Turn and returns control to it.
_Avoid_: Character Session, Director invocation

**Nested Character Turn**:
A Character Turn triggered by a Tool while another Character Turn remains open. It is durably nested in the Performance, returns its result to the calling Tool, and does not create a Director Point.
_Avoid_: Director action, hidden model call

**Top-level DM Turn**:
A role-play Character Turn that starts or repairs adjudication after an ordinary Character Turn. The first receives that Character Turn Projection; a repair Turn receives only the preceding validation failure. Successful voice-overs remain facts across repair Turns until a successful terminal Tool selects the next Character or completes the Performance.
_Avoid_: Nested perception adjudication

**Voice-over**:
A DM-authored role-play fact partitioned into Character-visible segments. Every ordinary Character is covered by each voice-over, and an empty segment means that Character perceives no content from it.
_Avoid_: DM prose, omniscient broadcast

**Character Recommendation**:
The DM's selection of the next ordinary Character together with a reason exposed for Agent observability. The selected Character drives scheduling; the reason does not.
_Avoid_: User override, Character Instruction

**Theater Main Loop**:
The Theater-owned control loop attached to a Performance. At each Director Point it requests one Director Decision and executes it by starting a Character Turn or completing the Performance. It owns execution and serial settlement, but not the domain judgment of which Character acts next or when the Performance completes.
_Avoid_: Theater Driver, Agent Loop, Director

**Automatic Advancement**:
Allows the Theater Main Loop to execute `act` Decisions automatically at each Director Point without an external call to `advance()`. It never prevents the Director from returning `complete`.
_Avoid_: Director Decision, round limit

**Director**:
The liveness decision component for a Performance. The Theater Main Loop calls it at each Director Point, and it uses the currently readable state to decide whether one Character acts with an Instruction or the Performance completes. It neither executes Characters, owns the Main Loop, nor persists orchestration boundaries; it only decides whether work remains and what that work is.
_Avoid_: Theater Main Loop, Agent Loop, Character

**Director Decision**:
A one-time decision returned by the Director at a Director Point. It is either `act`, naming one Character and its Instruction, or `complete`, completing the Performance. The decision is not persisted; a fork computes a fresh decision in the new Performance.
_Avoid_: Stage result, Character turn

**Director Point**:
A settled position in a Performance where no Character Turn is executing. The Theater Main Loop may call the Director there, and a Performance may be forked only there. It is a semantic position rather than an event: the initial Director Point exists after Performance creation settles, and each settled Character Turn produces the next Director Point.
_Avoid_: Character turn, arbitrary event boundary

**Instruction**:
The input to one Character Turn. It enters only the Character Session.
_Avoid_: Character history

**Role-play Character Instruction**:
The chronological `voice_over` content visible to one ordinary Character since its previous settled top-level Turn, or since Performance creation for its first Turn. Empty content is retained; recommendation reasons and wrapper text are excluded. The Instruction is appended only when the Character is selected to act.
_Avoid_: Character inbox, voice-over copy

**Character Turn Projection**:
A destination-specific natural-language view of the semantic content produced by one Character Turn: public assistant text, Tool calls, and Tool results in their original order. Role-play renders direct text with the former attempted speech/action label and renders `perceive_or_recall` calls and results with their established labels. It excludes the Instruction that entered the Turn, reasoning, call identity, display metadata, and execution-only events such as Turn and Step boundaries.
_Avoid_: Character Turn copy, Instruction replay

**Settled Character Turn Read**:
One Character's identity, settlement outcome, and exact Character Session Event slice for a settled Segment. It is reconstructed from durable Performance and Character Session records and is not separately persisted. Directors read only top-level Turns in Performance order; a nested-Turn caller receives the same read shape directly. Role-play owns the projection from this generic read model into Character Instructions.
_Avoid_: Role-play Transcript, scheduling cache
