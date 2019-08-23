import {Euler, Math as ThreeMath, Matrix4, Quaternion, Vector3} from "three"

import {Value} from "../core/react"
import {getValueStyleComponent} from "../core/ui"
import {Graph} from "../graph/graph"
import {inputEdge, inputEdges, outputEdge, property} from "../graph/meta"
import {
  Operator,
  OperatorConfig,
  Node,
  NodeConfig,
  NodeTypeRegistry,
} from "../graph/node"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {TransformComponent} from "./entity"

// patch in toString functions
Vector3.prototype.toString = function() { return `(${this.x}, ${this.y}, ${this.z})` }
Euler.prototype.toString = function() {
  return `(${radToDegString(this.x)}, ${radToDegString(this.y)}, ${radToDegString(this.z)})`
}

// path in getStyle functions
const Vector3Prototype = Vector3.prototype as any
Vector3Prototype.getStyle = function() {
  const self = this as Vector3
  const r = getValueStyleComponent(self.x)
  const g = getValueStyleComponent(self.y)
  const b = getValueStyleComponent(self.z)
  return `rgb(${r}, ${g}, ${b})`
}
const EulerPrototype = Euler.prototype as any
const angleScale = 127 / Math.PI
EulerPrototype.getStyle = function() {
  const self = this as Euler
  const r = Math.round(128 + normalizeAngle(self.x) * angleScale)
  const g = Math.round(128 + normalizeAngle(self.y) * angleScale)
  const b = Math.round(128 + normalizeAngle(self.z) * angleScale)
  return `rgb(${r}, ${g}, ${b})`
}

const TWO_PI = 2 * Math.PI
function normalizeAngle (angle :number) {
  while (angle < -Math.PI) angle += TWO_PI
  while (angle > Math.PI) angle -= TWO_PI
  return angle
}

function radToDegString (radians :number) {
  return Math.round(ThreeMath.radToDeg(radians) * 10) / 10
}

/** The different types of coordinate frames available. */
export type CoordinateFrame = "world" | "local"

/** The different rotation orders available. */
export type RotationOrder = "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX"

/** Creates a set of Euler angles from individual components. */
abstract class EulerConfig implements NodeConfig {
  type = "Euler"
  @property("RotationOrder") order = "XYZ"
  @inputEdge("number") x = undefined
  @inputEdge("number") y = undefined
  @inputEdge("number") z = undefined
  @outputEdge("Euler") output = undefined
}

class EulerNode extends Node {

  constructor (graph :Graph, id :string, readonly config :EulerConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
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
abstract class Vector3Config implements NodeConfig {
  type = "Vector3"
  @inputEdge("number") x = undefined
  @inputEdge("number") y = undefined
  @inputEdge("number") z = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3Node extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3Config) {
    super(graph, id, config)
  }

  protected _createOutput () {
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
abstract class Vector3SplitConfig implements NodeConfig {
  type = "Vector3.split"
  @inputEdge("Vector3") input = undefined
  @outputEdge("Vector3") x = undefined
  @outputEdge("Vector3") y = undefined
  @outputEdge("Vector3") z = undefined
}

class Vector3Split extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3SplitConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    return this.graph.getValue(this.config.input, new Vector3()).map(value => value[name])
  }
}

/** Adds a set of vectors. */
abstract class Vector3AddConfig implements OperatorConfig<Vector3> {
  type = "Vector3.add"
  @inputEdges("Vector3") inputs = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3Add extends Operator<Vector3> {

  constructor (graph :Graph, id :string, readonly config :Vector3AddConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () {
    return new Vector3()
  }

  protected _apply (values :Vector3[]) {
    const sum = new Vector3()
    for (const value of values) {
      sum.add(value)
    }
    return sum
  }
}

/** Applies an Euler angle rotation to a vector. */
abstract class Vector3ApplyEulerConfig implements NodeConfig {
  type = "Vector3.applyEuler"
  @inputEdge("Vector3") vector = undefined
  @inputEdge("Euler") euler = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3ApplyEuler extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ApplyEulerConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, new Vector3()),
        this.graph.getValue(this.config.euler, new Euler()),
      )
      .map(([vector, euler]) => vector.clone().applyEuler(euler))
  }
}

/** Projects a vector onto a plane. */
abstract class Vector3ProjectOnPlaneConfig implements NodeConfig {
  type = "Vector3.projectOnPlane"
  @property() planeNormal = new Vector3(0, 1, 0)
  @inputEdge("Vector3") input = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3ProjectOnPlane extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ProjectOnPlaneConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const planeNormal = this.config.planeNormal || new Vector3(0, 1, 0)
    return this.graph.getValue(this.config.input, new Vector3()).map(
      vector => vector.clone().projectOnPlane(planeNormal),
    )
  }
}

/** Multiplies a vector by a scalar. */
abstract class Vector3MultiplyScalarConfig implements NodeConfig {
  type = "Vector3.multiplyScalar"
  @inputEdge("Vector3") vector = undefined
  @inputEdge("number") scalar = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3MultiplyScalar extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3MultiplyScalarConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, new Vector3()),
        this.graph.getValue(this.config.scalar, 1),
      )
      .map(([vector, scalar]) => vector.clone().multiplyScalar(scalar))
  }
}

/** Computes the signed angle between two vectors about an axis. */
abstract class Vector3AngleBetweenConfig implements NodeConfig {
  type = "Vector3.angleBetween"
  @property() axis = new Vector3(0, 1, 0)
  @inputEdge("Vector3") v1 = undefined
  @inputEdge("Vector3") v2 = undefined
  @outputEdge("number") output = undefined
}

class Vector3AngleBetween extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3AngleBetweenConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const axis = this.config.axis || new Vector3(0, 1, 0)
    const first = new Vector3()
    const second = new Vector3()
    return Value
      .join2(
        this.graph.getValue(this.config.v1, new Vector3()),
        this.graph.getValue(this.config.v2, new Vector3()),
      )
      .map(([v1, v2]) => {
        first.copy(v1).projectOnPlane(axis)
        second.copy(v2).projectOnPlane(axis)
        return first.angleTo(second) * (first.cross(second).dot(axis) < 0 ? -1 : 1)
      })
  }
}

/** Produces a unit vector in a random direction. */
abstract class RandomDirectionConfig implements NodeConfig {
  type = "randomDirection"
  @outputEdge("Vector3") output = undefined
}

class RandomDirection extends Node {

  constructor (graph :Graph, id :string, readonly config :RandomDirectionConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.clock.fold(
      createRandomDirection(),
      (direction, clock) => createRandomDirection(),
    )
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
abstract class RotateConfig implements EntityComponentConfig {
  type = "rotate"
  @property() component = ""
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Euler") input = undefined
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  connect () {
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    this._disposer.add(
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
abstract class TranslateConfig implements EntityComponentConfig {
  type = "translate"
  @property() component = ""
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Vector3") input = undefined
}

class Translate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  connect () {
    const position = new Vector3()
    const quaternion = new Quaternion()
    this._disposer.add(
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

/** Reads an entity's transform. */
abstract class ReadTransformConfig implements EntityComponentConfig {
  type = "readTransform"
  @property() component = ""
  @outputEdge("Vector3") position = undefined
  @outputEdge("Quaternion") quaternion = undefined
  @outputEdge("Vector3") scale = undefined
}

class ReadTransform extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :ReadTransformConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    let getter :() => any
    switch (name) {
      case "quaternion":
        getter = () => this._component.readQuaternion(this._entityId, new Quaternion())
        break;
      case "scale":
        getter = () => this._component.readScale(this._entityId, new Vector3())
        break;
      default:
        getter = () => this._component.readPosition(this._entityId, new Vector3())
        break;
    }
    return this.graph.clock.fold(getter(), getter)
  }
}

/** Sets an entity's position. */
abstract class UpdatePositionConfig implements EntityComponentConfig {
  type = "updatePosition"
  @property() component = ""
  @inputEdge("Vector3") input = undefined
}

class UpdatePosition extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdatePositionConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(
      this.graph.getValue(this.config.input, new Vector3()).onValue(position => {
        this._component.updatePosition(this._entityId, position)
      }),
    )
  }
}

/** Sets an entity's rotation. */
abstract class UpdateRotationConfig implements EntityComponentConfig {
  type = "updateRotation"
  @property() component = ""
  @inputEdge("Euler") input = undefined
}

class UpdateRotation extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdateRotationConfig) {
    super(graph, id, config)
  }

  connect () {
    const quaternion = new Quaternion()
    this._disposer.add(
      this.graph.getValue(this.config.input, new Euler()).onValue(euler => {
        this._component.updateQuaternion(this._entityId, quaternion.setFromEuler(euler))
      }),
    )
  }
}

/** Sets an entity's scale. */
abstract class UpdateScaleConfig implements EntityComponentConfig {
  type = "updateScale"
  @property() component = ""
  @inputEdge("Vector3") input = undefined
}

class UpdateScale extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdateScaleConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(
      this.graph.getValue(this.config.input, new Vector3(1, 1, 1)).onValue(scale => {
        this._component.updateScale(this._entityId, scale)
      }),
    )
  }
}

/** Transforms a point from world space to the local space of the entity. */
abstract class WorldToLocalConfig implements EntityComponentConfig {
  type = "worldToLocal"
  @property() component = ""
  @inputEdge("Vector3") input = undefined
  @outputEdge("Vector3") output = undefined
}

class WorldToLocal extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :WorldToLocalConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    const matrix = new Matrix4()
    const inverse = new Matrix4()
    return this.graph.getValue(this.config.input, new Vector3()).map(point => {
      this._component.readPosition(this._entityId, position)
      this._component.readQuaternion(this._entityId, quaternion)
      this._component.readScale(this._entityId, scale)
      inverse.getInverse(matrix.compose(position, quaternion, scale))
      return point.clone().applyMatrix4(inverse)
    })
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("Euler", EulerNode)
  registry.registerNodeType("Vector3", Vector3Node)
  registry.registerNodeType("Vector3.split", Vector3Split)
  registry.registerNodeType("Vector3.add", Vector3Add)
  registry.registerNodeType("Vector3.applyEuler", Vector3ApplyEuler)
  registry.registerNodeType("Vector3.projectOnPlane", Vector3ProjectOnPlane)
  registry.registerNodeType("Vector3.multiplyScalar", Vector3MultiplyScalar)
  registry.registerNodeType("Vector3.angleBetween", Vector3AngleBetween)
  registry.registerNodeType("randomDirection", RandomDirection)
  registry.registerNodeType("rotate", Rotate)
  registry.registerNodeType("translate", Translate)
  registry.registerNodeType("readTransform", ReadTransform)
  registry.registerNodeType("updatePosition", UpdatePosition)
  registry.registerNodeType("updateRotation", UpdateRotation)
  registry.registerNodeType("updateScale", UpdateScale)
  registry.registerNodeType("worldToLocal", WorldToLocal)
}
