import {AnimationMixer, Event} from "three"

import {Mutable, Value} from "../core/react"
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
  /** The name of the condition that triggers the transition. */
  condition? :string
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
    const isTransitioning = Mutable.local(false)
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
        this._disposer.add(isTransitioning.onValue(transitioning => {
          if (transitioning) action.stop()
        }))
        action.reset()
        action.play()
      }))
    }
    const addTransitions = (config :StateConfig) => {
      if (!config.transitions) return
      for (const transitionKey in config.transitions) {
        if (transitionKey === name) continue
        const transition = config.transitions[transitionKey]
        let activateTransition :Value<boolean> = canTransition
        if (transition.condition) {
          const condition = this._conditions.get(transition.condition)
          if (!condition) throw new Error("Missing condition: " + transition.condition)
          let wasSet = false
          activateTransition = Value.join(canTransition, condition).map(([can, cond]) => {
            if (cond) wasSet = true
            return can && wasSet
          })
        }
        this._disposer.add(activateTransition.onValue(activate => {
          if (activate) {
            isTransitioning.update(true)
            this._enterState(transitionKey)
          }
        }))
      }
    }
    const anyStateConfig = this.config.states.any
    if (anyStateConfig) addTransitions(anyStateConfig)
    addTransitions(config)
  }

  dispose () {
    this._disposer.dispose()
  }
}
