import {Color, Euler, MathUtils as ThreeMath, Matrix4, Quaternion, Vector3} from "three"

import {Value} from "../core/react"
import {getValueStyleComponent} from "../core/ui"
import {Graph} from "../graph/graph"
import {
  activateNodeConfigs, inputEdge, inputEdges, outputEdge, property, setEnumMeta,
} from "../graph/meta"
import {Operator, OperatorConfig, Node, NodeConfig, NodeTypeRegistry} from "../graph/node"
import {addPropertyTypes} from "../graph/util"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {CanonicalTransformId, TransformComponent} from "./entity"

// patch in toString functions
Vector3.prototype.toString = function() { return `(${this.x}, ${this.y}, ${this.z})` }
Euler.prototype.toString = function() {
  return `(${radToDegString(this.x)}, ${radToDegString(this.y)}, ${radToDegString(this.z)})`
}
Color.prototype.toString = function() {
  return this.getStyle()
}

// patch in getStyle functions
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
const ColorPrototype = Color.prototype as any

// patch in nodeType properties
Vector3Prototype.nodeType = "Vector3.constant"
EulerPrototype.nodeType = "Euler.constant"
ColorPrototype.nodeType = "Color.constant"

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
setEnumMeta("CoordinateFrame", ["world", "local"])

/** The different rotation orders available. */
export type RotationOrder = "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX"
setEnumMeta("RotationOrder", ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"])

// add our property types
addPropertyTypes({Vector3: new Vector3(), Euler: new Euler(), Color: new Color()})

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

/** A constant set of Euler angles. */
abstract class EulerConstantConfig implements NodeConfig {
  type = "Euler.constant"
  @property() value = new Euler()
  @outputEdge("Euler") output = undefined
}

class EulerConstant extends Node {

  constructor (graph :Graph, id :string, readonly config :EulerConstantConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || new Euler())
  }
}

/** Creates a color from individual components. */
abstract class ColorConfig implements NodeConfig {
  type = "Color"
  @inputEdge("number") r = undefined
  @inputEdge("number") g = undefined
  @inputEdge("number") b = undefined
  @outputEdge("Color") output = undefined
}

class ColorNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ColorConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.r, 0),
        this.graph.getValue(this.config.g, 0),
        this.graph.getValue(this.config.b, 0),
      )
      .map(([r, g, b]) => new Color(r, g, b))
  }
}

/** A constant color value. */
abstract class ColorConstantConfig implements NodeConfig {
  type = "Color.constant"
  @property("ThreeColor") value = new Color()
  @outputEdge("Color") output = undefined
}

class ColorConstant extends Node {

  constructor (graph :Graph, id :string, readonly config :ColorConstantConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || new Color())
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

/** A constant vector value. */
abstract class Vector3ConstantConfig implements NodeConfig {
  type = "Vector3.constant"
  @property() value = new Vector3()
  @outputEdge("Vector3") output = undefined
}

class Vector3Constant extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ConstantConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || new Vector3())
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

/** Applies a quaternion rotation to a vector. */
abstract class Vector3ApplyQuaternionConfig implements NodeConfig {
  type = "Vector3.applyQuaternion"
  @inputEdge("Vector3") vector = undefined
  @inputEdge("Quaternion") quaternion = undefined
  @outputEdge("Vector3") output = undefined
}

class Vector3ApplyQuaternion extends Node {

  constructor (graph :Graph, id :string, readonly config :Vector3ApplyQuaternionConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, new Vector3()),
        this.graph.getValue(this.config.quaternion, new Quaternion()),
      )
      .map(([vector, quaternion]) => vector.clone().applyQuaternion(quaternion))
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
  @property() component = CanonicalTransformId
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Euler") input = undefined
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  connect () {
    const component = this._component
    if (!component) return
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    this._disposer.add(
      this.graph.getValue(this.config.input, new Euler()).onValue(euler => {
        component.readQuaternion(this._entityId, quaternion)
        rotation.setFromEuler(euler)
        if (this.config.frame === "world") quaternion.premultiply(rotation)
        else quaternion.multiply(rotation)
        component.updateQuaternion(this._entityId, quaternion)
      }),
    )
  }
}

/** Translates by an amount determined by the inputs. */
abstract class TranslateConfig implements EntityComponentConfig {
  type = "translate"
  @property() component = CanonicalTransformId
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Vector3") input = undefined
}

class Translate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    const position = new Vector3()
    const quaternion = new Quaternion()
    this._disposer.add(
      this.graph.getValue(this.config.input, new Vector3()).onValue(vector => {
        component.readPosition(this._entityId, position)
        if (this.config.frame !== "world") {
          component.readQuaternion(this._entityId, quaternion)
          vector.applyQuaternion(quaternion)
        }
        component.updatePosition(this._entityId, position.add(vector))
      }),
    )
  }
}

/** Reads an entity's transform. */
abstract class ReadTransformConfig implements EntityComponentConfig {
  type = "readTransform"
  @property() component = CanonicalTransformId
  @outputEdge("Vector3") position = undefined
  @outputEdge("Quaternion") quaternion = undefined
  @outputEdge("Vector3") scale = undefined
}

class ReadTransform extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :ReadTransformConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    const component = this._component
    if (!component) {
      switch (name) {
        case "quaternion": return Value.constant(new Quaternion())
        case "scale": return Value.constant(new Vector3(1, 1, 1))
        default: return Value.constant(new Vector3())
      }
    }
    let getter :() => any
    switch (name) {
      case "quaternion":
        getter = () => component.readQuaternion(this._entityId, new Quaternion())
        break;
      case "scale":
        getter = () => component.readScale(this._entityId, new Vector3())
        break;
      default:
        getter = () => component.readPosition(this._entityId, new Vector3())
        break;
    }
    return this.graph.clock.fold(getter(), getter)
  }
}

/** Sets an entity's position. */
abstract class UpdatePositionConfig implements EntityComponentConfig {
  type = "updatePosition"
  @property() component = CanonicalTransformId
  @inputEdge("Vector3") input = undefined
}

class UpdatePosition extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdatePositionConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    this._disposer.add(
      this.graph.getValue(this.config.input, new Vector3()).onValue(position => {
        component.updatePosition(this._entityId, position)
      }),
    )
  }
}

/** Sets an entity's rotation. */
abstract class UpdateRotationConfig implements EntityComponentConfig {
  type = "updateRotation"
  @property() component = CanonicalTransformId
  @inputEdge("Euler") input = undefined
}

class UpdateRotation extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdateRotationConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    const quaternion = new Quaternion()
    this._disposer.add(
      this.graph.getValue(this.config.input, new Euler()).onValue(euler => {
        component.updateQuaternion(this._entityId, quaternion.setFromEuler(euler))
      }),
    )
  }
}

/** Sets an entity's scale. */
abstract class UpdateScaleConfig implements EntityComponentConfig {
  type = "updateScale"
  @property() component = CanonicalTransformId
  @inputEdge("Vector3") input = undefined
}

class UpdateScale extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :UpdateScaleConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    this._disposer.add(
      this.graph.getValue(this.config.input, new Vector3(1, 1, 1)).onValue(scale => {
        component.updateScale(this._entityId, scale)
      }),
    )
  }
}

/** Transforms a point from world space to the local space of the entity. */
abstract class WorldToLocalConfig implements EntityComponentConfig {
  type = "worldToLocal"
  @property() component = CanonicalTransformId
  @inputEdge("Vector3") input = undefined
  @outputEdge("Vector3") output = undefined
}

class WorldToLocal extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :WorldToLocalConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const component = this._component
    if (!component) return this.graph.getValue(this.config.input, new Vector3())
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    const matrix = new Matrix4()
    const inverse = new Matrix4()
    return this.graph.getValue(this.config.input, new Vector3()).map(point => {
      component.readPosition(this._entityId, position)
      component.readQuaternion(this._entityId, quaternion)
      component.readScale(this._entityId, scale)
      inverse.getInverse(matrix.compose(position, quaternion, scale))
      return point.clone().applyMatrix4(inverse)
    })
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["space", "Vector3"], {
    Vector3: Vector3Node,
    "Vector3.constant": Vector3Constant,
    "Vector3.split": Vector3Split,
    "Vector3.add": Vector3Add,
    "Vector3.applyEuler": Vector3ApplyEuler,
    "Vector3.applyQuaternion": Vector3ApplyQuaternion,
    "Vector3.projectOnPlane": Vector3ProjectOnPlane,
    "Vector3.multiplyScalar": Vector3MultiplyScalar,
    "Vector3.angleBetween": Vector3AngleBetween,
  })
  registry.registerNodeTypes(["space", "Euler"], {
    Euler: EulerNode,
    "Euler.constant": EulerConstant,
  })
  registry.registerNodeTypes(["space", "Color"], {
    Color: ColorNode,
    "Color.constant": ColorConstant,
  })
  activateNodeConfigs(RotateConfig, TranslateConfig)
  registry.registerNodeTypes(["space"], {
    randomDirection: RandomDirection,
    rotate: Rotate,
    translate: Translate,
    readTransform: ReadTransform,
    updatePosition: UpdatePosition,
    updateRotation: UpdateRotation,
    updateScale: UpdateScale,
    worldToLocal: WorldToLocal,
  })
}
