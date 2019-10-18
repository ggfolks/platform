import {quat, vec3} from "../core/math"
import {Value} from "../core/react"
import {getValue} from "../core/util"
import {Graph} from "./graph"
import {Node, NodeConfig, NodeTypeRegistry} from "./node"
import {inputEdge, inputEdges, outputEdge, property} from "./meta"

/** Creates a vector from individual components. */
abstract class Vec3FromValuesConfig implements NodeConfig {
  type = "vec3.fromValues"
  @inputEdge("number") x = undefined
  @inputEdge("number") y = undefined
  @inputEdge("number") z = undefined
  @outputEdge("vec3") output = undefined
}

class Vec3FromValues extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3FromValuesConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.x, 0),
        this.graph.getValue(this.config.y, 0),
        this.graph.getValue(this.config.z, 0),
      )
      .map(createVec3Fn((out, [x, y, z]) => vec3.set(out, x, y, z)))
  }
}

/** Creates a function that alternates between two output vectors, so as to avoid creating new
  * vector objects every time the function is called.
  * @param populator the function to populate the vector.
  * @return the wrapped function. */
export function createVec3Fn (
  populator :(out :vec3, arg? :any) => vec3,
) :(arg? :any) => vec3 {
  const values = [vec3.create(), vec3.create()]
  let index = 0
  return arg => {
    const value = populator(values[index], arg)
    if (vec3.exactEquals(values[0], values[1])) return values[1 - index]
    index = 1 - index
    return value
  }
}

/** Creates a function that alternates between two output quaternions, so as to avoid creating new
  * quaternion objects every time the function is called.
  * @param populator the function to populate the quaternion.
  * @return the wrapped function. */
export function createQuatFn (
  populator :(out :quat, arg? :any) => quat,
) :(arg? :any) => quat {
  const values = [quat.create(), quat.create()]
  let index = 0
  return arg => {
    const value = populator(values[index], arg)
    if (quat.exactEquals(values[0], values[1])) return values[1 - index]
    index = 1 - index
    return value
  }
}

/** A constant vector value. */
abstract class Vec3ConstantConfig implements NodeConfig {
  type = "vec3.constant"
  @property("vec3") value = vec3.create()
  @outputEdge("vec3") output = undefined
}

class Vec3Constant extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3ConstantConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || vec3.create())
  }
}

/** Adds a set of vectors. */
abstract class Vec3AddConfig implements NodeConfig {
  type = "vec3.add"
  @inputEdges("vec3") inputs = undefined
  @outputEdge("vec3") output = undefined
}

class Vec3Add extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3AddConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph
      .getValues(this.config.inputs, vec3.create())
      .map(createVec3Fn((out, values) => {
        // @ts-ignore vec3.zero not in type definition
        vec3.zero(out)
        for (const value of values) vec3.add(out, out, value)
        return out
      }))
  }
}

/** Multiplies a vector by a scalar. */
abstract class Vec3ScaleConfig implements NodeConfig {
  type = "vec3.scale"
  @inputEdge("vec3") vector = undefined
  @inputEdge("number") scalar = undefined
  @outputEdge("vec3") output = undefined
}

class Vec3Scale extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3ScaleConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, vec3.create()),
        this.graph.getValue(this.config.scalar, 1),
      )
      .map(createVec3Fn((out, [vector, scalar]) => vec3.scale(out, vector, scalar)))
  }
}

/** Transforms a vector by a quaternion. */
abstract class Vec3TransformQuatConfig implements NodeConfig {
  type = "vec3.transformQuat"
  @inputEdge("vec3") vector = undefined
  @inputEdge("quat") quaternion = undefined
  @outputEdge("vec3") output = undefined
}

class Vec3TransformQuat extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3TransformQuatConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join2(
        this.graph.getValue(this.config.vector, vec3.create()),
        this.graph.getValue(this.config.quaternion, quat.create()),
      )
      .map(createVec3Fn((out, [vector, quaternion]) => vec3.transformQuat(out, vector, quaternion)))
  }
}

/** Projects a vector onto a plane. */
abstract class Vec3ProjectOnPlaneConfig implements NodeConfig {
  type = "vec3.projectOnPlane"
  @property("vec3") planeNormal = vec3.fromValues(0, 1, 0)
  @inputEdge("vec3") input = undefined
  @outputEdge("vec3") output = undefined
}

class Vec3ProjectOnPlane extends Node {

  constructor (graph :Graph, id :string, readonly config :Vec3ProjectOnPlaneConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const planeNormal = getValue(this.config.planeNormal, vec3.fromValues(0, 1, 0))
    return this.graph
      .getValue(this.config.input, vec3.create())
      .map(createVec3Fn((out, input) => {
        vec3.cross(out, input, planeNormal)
        vec3.cross(out, planeNormal, out)
        vec3.normalize(out, out)
        return vec3.scale(out, out, vec3.dot(out, input))
      }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerMatrixNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["matrix", "vec3"], {
    "vec3.fromValues": Vec3FromValues,
    "vec3.constant": Vec3Constant,
    "vec3.add": Vec3Add,
    "vec3.scale": Vec3Scale,
    "vec3.transformQuat": Vec3TransformQuat,
    "vec3.projectOnPlane": Vec3ProjectOnPlane,
  })
}
