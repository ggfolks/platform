import {Euler, Math as ThreeMath, Quaternion, Vector3} from "three"
import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {TransformComponent} from "./entity"

/** The different types of coordinate frames available. */
export type CoordinateFrame = "world" | "local"

/** Creates a set of Euler angles from individual components. */
export interface EulerConfig extends NodeConfig {
  type :"Euler"
  order? :string
  x :InputEdge<number>
  y :InputEdge<number>
  z :InputEdge<number>
  output :OutputEdge<Euler>
}

class EulerNode extends Node {

  constructor (graph :Graph, id :string, readonly config :EulerConfig) {
    super(graph, id, config)
  }

  getOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.x, 0),
        this.graph.getValue(this.config.y, 0),
        this.graph.getValue(this.config.z, 0),
      )
      .map(([x, y, z]) => new Euler(x, y, z, this.config.order))
  }
}

/** Creates a vector from individual components. */
export interface Vector3Config extends NodeConfig {
  type :"Vector3"
  x :InputEdge<number>
  y :InputEdge<number>
  z :InputEdge<number>
  output :OutputEdge<Vector3>
}

class Vector3Node extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3Config) {
    super(graph, id, config)
  }

  getOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.x, 0),
        this.graph.getValue(this.config.y, 0),
        this.graph.getValue(this.config.z, 0),
      )
      .map(([x, y, z]) => new Vector3(x, y, z))
  }
}

/** Splits a vector into its individual components. */
export interface Vector3SplitConfig extends NodeConfig {
  type :"Vector3.split"
  input :InputEdge<Vector3>
  x :OutputEdge<number>
  y :OutputEdge<number>
  z :OutputEdge<number>
}

class Vector3Split extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3SplitConfig) {
    super(graph, id, config)
  }

  getOutput (name :string = "x") {
    return this.graph.getValue(this.config.input, new Vector3()).map(value => value[name])
  }
}

/** Applies an Euler angle rotation to a vector. */
export interface Vector3ApplyEulerConfig extends NodeConfig {
  type :"Vector3.applyEuler"
  vector :InputEdge<Vector3>
  euler :InputEdge<Euler>
  output :OutputEdge<Vector3>
}

class Vector3ApplyEuler extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ApplyEulerConfig) {
    super(graph, id, config)
  }

  getOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, new Vector3()),
        this.graph.getValue(this.config.euler, new Euler()),
      )
      .map(([vector, euler]) => vector.clone().applyEuler(euler))
  }
}

/** Projects a vector onto a plane. */
export interface Vector3ProjectOnPlaneConfig extends NodeConfig {
  type :"Vector3.projectOnPlane"
  planeNormal? :Vector3
  input :InputEdge<Vector3>
  output :OutputEdge<Vector3>
}

class Vector3ProjectOnPlane extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ProjectOnPlaneConfig) {
    super(graph, id, config)
  }

  getOutput () {
    const planeNormal = this.config.planeNormal || new Vector3(0, 1, 0)
    return this.graph.getValue(this.config.input, new Vector3()).map(
      vector => vector.clone().projectOnPlane(planeNormal),
    )
  }
}

/** Multiplies a vector by a scalar. */
export interface Vector3MultiplyScalarConfig extends NodeConfig {
  type :"Vector3.multiplyScalar"
  vector :InputEdge<Vector3>
  scalar :InputEdge<number>
  output :OutputEdge<Vector3>
}

class Vector3MultiplyScalar extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3MultiplyScalarConfig) {
    super(graph, id, config)
  }

  getOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, new Vector3()),
        this.graph.getValue(this.config.scalar, 1),
      )
      .map(([vector, scalar]) => vector.clone().multiplyScalar(scalar))
  }
}

/** Produces a unit vector in a random direction. */
export interface RandomDirectionConfig extends NodeConfig {
  type :"randomDirection"
  output :OutputEdge<Vector3>
}

class RandomDirection extends Node {
  private _output = this.graph.clock.fold(
    createRandomDirection(),
    (direction, clock) => createRandomDirection(),
  )

  constructor (graph :Graph, id :string, readonly config :RandomDirectionConfig) {
    super(graph, id, config)
  }

  getOutput () {
    return this._output
  }
}

function createRandomDirection () {
  // https://github.com/ey6es/clyde/blob/master/core/src/main/java/com/threerings/opengl/effect/config/ShooterConfig.java#L110
  const cosa = ThreeMath.randFloatSpread(2)
  const sina = Math.sqrt(1 - cosa*cosa)
  const theta = Math.random() * Math.PI * 2
  return new Vector3(Math.cos(theta) * sina, Math.sin(theta) * sina, cosa)
}

/** Rotates by an amount determined by the inputs. */
export interface RotateConfig extends EntityComponentConfig {
  type :"rotate"
  frame? :CoordinateFrame
  input :InputEdge<Euler>
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  connect () {
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    this._removers.push(
      this.graph.getValue(this.config.input, new Euler()).onValue(euler => {
        this._component.readQuaternion(this._entityId, quaternion)
        rotation.setFromEuler(euler)
        if (this.config.frame === "world") quaternion.premultiply(rotation)
        else quaternion.multiply(rotation)
        this._component.updateQuaternion(this._entityId, quaternion)
      }),
    )
  }
}

/** Translates by an amount determined by the inputs. */
export interface TranslateConfig extends EntityComponentConfig {
  type :"translate"
  frame? :CoordinateFrame
  input :InputEdge<Vector3>
}

class Translate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  connect () {
    const position = new Vector3()
    const quaternion = new Quaternion()
    this._removers.push(
      this.graph.getValue(this.config.input, new Vector3()).onValue(vector => {
        this._component.readPosition(this._entityId, position)
        if (this.config.frame !== "world") {
          this._component.readQuaternion(this._entityId, quaternion)
          vector.applyQuaternion(quaternion)
        }
        this._component.updatePosition(this._entityId, position.add(vector))
      }),
    )
  }
}

/** Sets an entity's rotation. */
export interface UpdateRotationConfig extends EntityComponentConfig {
  type :"updateRotation"
  input :InputEdge<Euler>
}

class UpdateRotation extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdateRotationConfig) {
    super(graph, id, config)
  }

  connect () {
    const quaternion = new Quaternion()
    this._removers.push(
      this.graph.getValue(this.config.input, new Euler()).onValue(euler => {
        this._component.updateQuaternion(this._entityId, quaternion.setFromEuler(euler))
      }),
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("Euler", EulerNode)
  registry.registerNodeType("Vector3", Vector3Node)
  registry.registerNodeType("Vector3.split", Vector3Split)
  registry.registerNodeType("Vector3.applyEuler", Vector3ApplyEuler)
  registry.registerNodeType("Vector3.projectOnPlane", Vector3ProjectOnPlane)
  registry.registerNodeType("Vector3.multiplyScalar", Vector3MultiplyScalar)
  registry.registerNodeType("randomDirection", RandomDirection)
  registry.registerNodeType("rotate", Rotate)
  registry.registerNodeType("translate", Translate)
  registry.registerNodeType("updateRotation", UpdateRotation)
}
