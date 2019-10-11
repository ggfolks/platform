import {vec3} from "../core/math"
import {Clock} from "../core/clock"
import {Disposable} from "../core/util"
import {Component} from "./game"

/** Top-level interface to physics engine. */
export interface PhysicsEngine extends Disposable {

  /** The global gravity vector. */
  gravity :vec3

  /** Updates the physics engine. Should be called once per frame. */
  update (clock :Clock) :void
}

/** Represents a body with physical behavior. */
export interface RigidBody extends Component {

  /** The mass of the body. */
  mass :number
}
