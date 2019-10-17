import {vec3} from "../core/math"
import {Value} from "../core/react"
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

/** Registers the nodes in this module with the supplied registry. */
export function registerMatrixNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["matrix", "vec3"], {
    "vec3.fromValues": Vec3FromValues,
    "vec3.constant": Vec3Constant,
    "vec3.add": Vec3Add,
    "vec3.scale": Vec3Scale,
  })
}
