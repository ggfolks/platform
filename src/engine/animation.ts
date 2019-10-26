import {Value} from "../core/react"
import {PMap} from "../core/util"
import {Component} from "./game"

/** Represents a set of (GLTF) animations loaded from URLs. */
export interface Animation extends Component {

  /** The URL of the first animation, if any. */
  url? :string

  /** The URLs of the animations to load. */
  urls :string[]

  /** Whether or not to play the animation automatically on startup. */
  playAutomatically :boolean

  /** Plays an animation
    * @param [name] the name of the animation to play, if not the default. */
  play (name? :string) :void
}

/** Manages an animation state graph. */
export interface AnimationController extends Component {

  /** The controller configuration. */
  config :AnimationControllerConfig

  /** The current animation state. */
  state :Value<string>
}

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
  /** The time scale for the animation (default: 1). */
  timeScale? :number
  /** Whether to wait for the animation to complete before transitioning (default: false). */
  finishBeforeTransition? :boolean
  /** Transitions with priorities greater than this value can interrupt the animation even if
    * we're waiting for it to complete (default: zero). */
  interruptPriority? :number
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