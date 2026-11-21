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
A DSH Preset that defines a Performance's Characters, zero or more Stages, and default Director.

**Performance Configuration**:
The durable snapshot of a Performance's Characters, Tool configurations, and declared Stages captured at creation. It remains authoritative across resume and fork; runtime advancement pacing and the plugged-in Director are excluded.
_Avoid_: Preset equality check, live config override

**Stage-free Performance**:
A Performance whose durable Character Turns and Performance ordering contain all facts needed for its Director decisions. It declares no Stage.
_Avoid_: Synthetic Stage, stateless Stage

**Character**:
An Agent scheduled within a Performance. That Agent's Session is called a Character Session.

**Character Session**:
The Session of a Character. It stores that Character's Agent history, is created, resumed, and forked with the Performance, and has no independent fork semantics.
_Avoid_: Performance Session, Shared transcript

**Character Turn**:
One ordinary DSH Agent Turn executed by a Character and managed by Theater. A top-level Character Turn is triggered by a Director `act` Decision and, when `completed`, settles at the next Director Point; a Nested Character Turn is triggered within another Character Turn and returns control to it.
_Avoid_: Character Session, Director invocation

**Nested Character Turn**:
A Character Turn triggered by a Tool while another Character Turn remains open. It is durably nested in the Performance for history and outer fork boundaries, returns its result to the calling Tool, creates no Director Point, and cannot be resumed mid-flight after a crash.
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
The Theater-owned control loop attached to a Performance. At each Director Point it awaits one cancellable Director Decision, executes an `act` Turn or completes the Performance, and halts on any non-completed top-level Turn; it owns execution, serial settlement, and failure halting, not advancement pacing or scheduling policy.
_Avoid_: Theater Driver, Agent Loop, Director

**Director**:
The pluggable liveness and advancement component for a Performance, replaceable across create, resume, and fork (such as automatic, step-gated, or human-driven implementations). Awaited once per Director Point with cancellation support, it decides whether one Character acts with an Instruction or the Performance completes, owning advancement pacing without executing Characters or persisting orchestration boundaries.
_Avoid_: Theater Main Loop, Agent Loop, Character, Theater-owned autoAdvance

**Director Decision**:
A one-time decision returned by the Director at a Director Point. It is either `act`, naming one Character and its Instruction, or `complete`, completing the Performance. The decision is not persisted; a fork computes a fresh decision in the new Performance.
_Avoid_: Stage result, Character turn

**Director Point**:
A settled position in a Performance where no Character Turn is executing and the Performance can safely request a Director Decision, resume, or fork. The initial Director Point exists after Performance creation settles, and only a `completed` top-level Character Turn produces the next Director Point; an active Performance awaiting a Director Decision remains at its current Director Point.
_Avoid_: Character turn, arbitrary event boundary, failed Turn boundary

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
A structured, read-only view of one Character Turn's identity, settlement outcome, and semantic content reconstructed from durable Performance and Character Session records without separate persistence. Directors and Tools share this boundary for settled top-level Turns (plus the active Turn for Tools), avoiding direct access to raw Session events; Role-play owns the projection into Character Instructions.
_Avoid_: Role-play Transcript, scheduling cache, raw Session event scraping
