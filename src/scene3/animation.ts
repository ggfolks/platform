import {AnimationMixer, Event} from "three"

import {Emitter, Mutable, Value} from "../core/react"
import {Disposable, Disposer, PMap, getValue} from "../core/util"
import {loadGLTFAnimationClip} from "./entity"

/** The configuration for an animation controller. */
export interface AnimationControllerConfig {
  states :{ default: StateConfig, [name :string]: StateConfig }
}

/** The configuration for a single animation state. */
export interface StateConfig {
  /** The URL of the animation associated with the state, if any (default: none). */
  url? :string
  /** The number of repetitions of the animation to perform (default: Infinity). */
  repetitions? :number
  /** Whether to pause the animation on its last frame when finished (default: false). */
  clampWhenFinished? :boolean
  /** Whether to wait for the animation to complete before transitioning (default: false). */
  finishBeforeTransition? :boolean
  /** Describes the transitions to other states, if any. */
  transitions? :PMap<TransitionConfig>
}

/** Describes the transition to a given state. */
export interface TransitionConfig {
  /** The name of the condition that triggers the transition.  May begin with ! to negate. */
  condition? :string
  /** The priority that determines which transition to select if multiple ones are valid
    * (default: zero). */
  priority? :number
  /** The weight that determines the random selection between transitions of same priority
    * (default: one). */
  weight? :number
}

/** Similar to Unity's AnimationController, instances of this class manage a state machine where
  * states have associated animations and transition between states is determined by a set of
  * triggers. */
export class AnimationController implements Disposable {
  private readonly _disposer = new Disposer()
  private readonly _state = Mutable.local("default")

  get state () :Value<string> { return this._state }

  constructor (
    private readonly _mixer :AnimationMixer,
    private readonly _conditions :Map<string, Value<boolean>>,
    readonly config :AnimationControllerConfig,
  ) {
    this._enterState("default")
  }

  private _enterState (name :string) {
    this._disposer.dispose()
    this._state.update(name)
    const config = this.config.states[name]
    if (!config) throw new Error("Missing state config: " + name)
    const canTransition = Mutable.local(true)
    const transitioning = new Emitter<void>()
    if (config.url) {
      if (config.finishBeforeTransition) canTransition.update(false)
      this._disposer.add(loadGLTFAnimationClip(config.url).once(clip => {
        const action = this._mixer.clipAction(clip)
        action.clampWhenFinished = getValue(config.clampWhenFinished, false)
        action.repetitions = getValue(config.repetitions, Infinity)
        if (config.finishBeforeTransition) {
          const listener = (event :Event) => {
            if (event.action === action) {
              canTransition.update(true)
              this._mixer.removeEventListener("finished", listener)
            }
          }
          this._mixer.addEventListener("finished", listener)
        }
        this._disposer.add(transitioning.onEmit(() => action.stop()))
        action.reset()
        action.play()
      }))
    }
    const stateTransitions :[string, TransitionConfig][] = []
    const conditions :Value<boolean>[] = []
    const addTransitions = (config :StateConfig) => {
      if (!config.transitions) return
      for (const transitionKey in config.transitions) {
        if (transitionKey === name) continue // can't transition to the current state
        const transition = config.transitions[transitionKey]
        stateTransitions.push([transitionKey, transition])
        if (transition.condition) {
          const condition = this._getCondition(transition.condition)
          if (!condition) throw new Error("Missing condition: " + transition.condition)
          let wasSet = false
          conditions.push(condition.map(condition => {
            if (condition) wasSet = true
            return wasSet
          }))
        } else conditions.push(Value.constant<boolean>(true))
      }
    }
    addTransitions(config)
    const anyStateConfig = this.config.states.any
    if (anyStateConfig) addTransitions(anyStateConfig)

    this._disposer.add(Value.join2(canTransition, Value.join(...conditions)).onValue(
      ([can, conds]) => {
        if (!can) return
        let highestPriority = -Infinity
        let totalWeight = 0
        const highestPriorityStateTransitions :[string, TransitionConfig][] = []
        for (let ii = 0; ii < stateTransitions.length; ii++) {
          if (!conds[ii]) continue
          const stateTransition = stateTransitions[ii]
          const transition = stateTransition[1]
          const priority = getValue(transition.priority, 0)
          const weight = getValue(transition.weight, 1)
          if (priority > highestPriority) {
            highestPriority = priority
            highestPriorityStateTransitions.length = 0
            highestPriorityStateTransitions.push(stateTransition)
            totalWeight = weight

          } else if (priority === highestPriority) {
            highestPriorityStateTransitions.push(stateTransition)
            totalWeight += weight
          }
        }
        if (highestPriorityStateTransitions.length === 0) return
        transitioning.emit()
        if (highestPriorityStateTransitions.length === 1) {
          this._enterState(highestPriorityStateTransitions[0][0])
          return
        }
        let targetWeight = totalWeight * Math.random()
        for (const [state, transition] of highestPriorityStateTransitions) {
          if ((targetWeight -= getValue(transition.weight, 1)) <= 0) {
            this._enterState(state)
            return
          }
        }
      },
    ))
  }

  private _getCondition (name :string) :Value<boolean>|undefined {
    if (!name.startsWith("!")) return this._conditions.get(name)
    const baseCondition = this._conditions.get(name.substring(1))
    return baseCondition && baseCondition.map(condition => !condition)
  }

  dispose () {
    this._disposer.dispose()
  }
}
