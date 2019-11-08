import {Clock} from "../core/clock"
import {Emitter, Stream, Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Disposable, log, toLimitedString} from "../core/util"
import {InputEdge, InputEdges, Node, NodeConfig, NodeContext} from "./node"

/** Configuration for a graph. */
export interface GraphConfig {
  [id :string] :NodeConfig
}

/** Returns the node id used for a fixed constant, reactive value, or inline config. */
export function getImplicitNodeId (value :any) {
  return (value instanceof Value)
    ? getValueNodeId(value)
    : value.type
    ? getInlineNodeId(value)
    : getConstantNodeId(value)
}

const valueIds = new WeakMap<Value<any>, string>()
let nextValueId = 1

/** Returns the node id used for a reactive value. */
function getValueNodeId (value :Value<any>) :string {
  let id = valueIds.get(value)
  if (id === undefined) valueIds.set(value, id = `$${nextValueId++}`)
  return id
}

let lastConfigId = 0

/** Returns the node id used for an inline config. */
function getInlineNodeId (value :NodeConfig) {
  if (!value._configId) value._configId = ++lastConfigId
  return `%${value._configId}`
}

/** Returns the node id used for a fixed constant value. */
function getConstantNodeId (value :any) {
  if (value && value.value !== undefined) value = value.value
  return `__${toLimitedString(value)}`
}

/** An execution graph. */
export class Graph implements Disposable {
  private _clock = new Emitter<Clock>()
  private _nodes = MutableMap.local<string, Node>()

  /** Returns a reactive view of the clock event stream. */
  get clock () :Stream<Clock> {
    return this._clock
  }

  /** Returns a reactive view of the map from node id to Node. */
  get nodes () :RMap<string, Node> {
    return this._nodes
  }

  constructor (readonly ctx :NodeContext, readonly config :GraphConfig) {
    for (let id in config) {
      this._nodes.set(id, ctx.types.createNode(this, id, config[id]))
    }
  }

  /** Reconfigures this graph with the supplied config.
    * @param config the new config to apply. */
  reconfigure (config :GraphConfig) {
    // remove any nodes no longer in the config
    for (const id of this.nodes.keys()) {
      if (config[id] === undefined) this.removeNode(id)
    }
    // add/re-add any nodes present
    for (const id in config) {
      if (this.nodes.has(id)) this.removeNode(id)
      this.createNode(id, config[id])
    }
    // connect after everything's in place
    for (const id in config) {
      this.nodes.require(id).connect()
    }
  }

  /** Creates a node with the supplied id and configuration, but does not connect it. */
  createNode (id :string, config :NodeConfig) {
    this._nodes.set(id, this.ctx.types.createNode(this, id, this.config[id] = config))
  }

  /** Removes the node identified by `id` from the graph and returns its config. */
  removeNode (id :string) :NodeConfig {
    const node = this._nodes.require(id)
    this._nodes.delete(id)
    node.dispose()
    delete this.config[node.id]
    return node.config
  }

  /** Removes all the nodes in the graph. */
  removeAllNodes () {
    for (const node of this._nodes.values()) {
      node.dispose()
      delete this.config[node.id]
    }
    this._nodes.clear()
  }

  /** Connects the nodes in the graph. */
  connect () {
    for (const node of this._nodes.values()) {
      node.connect()
    }
  }

  /** Creates a string representing a vertex shader for this graph. */
  createVertexShader () :string {
    return `
      varying vec4 worldPosition;
      void main(void) {
        worldPosition = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
  }

  /** Creates a string representing a fragment shader for this graph. */
  createFragmentShader () :string {
    return `
      varying vec4 worldPosition;
      void main(void) {
        vec4 modPosition = mod(worldPosition.xzxz, vec4(vec2(1.0), vec2(0.2)));
        vec4 lowerSteps = step(vec4(vec2(0.02), vec2(0.005)), modPosition);
        vec4 upperSteps = vec4(1.0) - step(vec4(vec2(0.98), vec2(0.195)), modPosition);
        float scale = 0.25 * exp(-0.1 * distance(worldPosition.xz, cameraPosition.xz));
        gl_FragColor = mix(
          vec4(scale, scale, scale, 1.0),
          vec4(0.0, 0.0, 0.0, 1.0),
          lowerSteps.x * lowerSteps.y * lowerSteps.z * lowerSteps.w *
          upperSteps.x * upperSteps.y * upperSteps.z * upperSteps.w
        );
      }
    `
  }

  /** Retrieves a reactive value representing the identified input edges. */
  getValues<T> (inputs :InputEdges<T>, defaultValue :T) :Value<T[]> {
    if (!inputs) {
      return Value.constant([] as T[])
    }
    return Value.join(...inputs.map(input => this.getValue(input, defaultValue)))
  }

  /** Retrieves a reactive value representing the identified input edge. */
  getValue<T> (input :InputEdge<T>, defaultValue :T) :Value<T> {
    if (input === undefined || input === null) {
      return Value.constant(defaultValue)
    }
    if (Array.isArray(input)) {
      const [nodeIdOrConfig, outputName] = input
      const node = this._getOrCreateNode(nodeIdOrConfig)
      return node ? node.getOutput(outputName, defaultValue) : Value.constant(defaultValue)
    }
    const inputAsNodeConfig = input as NodeConfig
    if (typeof input === "string" || inputAsNodeConfig.type) {
      const node = this._getOrCreateNode(inputAsNodeConfig)
      return node ? node.getOutput(undefined, defaultValue) : Value.constant(defaultValue)
    }
    if (input instanceof Value) {
      const id = getValueNodeId(input)
      let node = this._nodes.get(id)
      if (!node) {
        this._nodes.set(id, node = this.ctx.types.createNode(this, id, {
          type: "value",
          value: input,
        }))
      }
      return node.getOutput(undefined, defaultValue)
    }
    const id = getConstantNodeId(input)
    let node = this._nodes.get(id)
    if (!node) {
      let value :any = input
      if (value && value.value !== undefined) value = value.value
      let type = typeof value as string
      if (type === "object") {
        if (value && value.nodeType) type = value.nodeType
        else if (value instanceof Float32Array) {
          // special handling for raw arrays used by gl-matrix
          switch (value.length) {
            case 3: type = "vec3.constant" ; break
            default: throw new Error("No node type for array length: " + value.length)
          }
        }
        else throw new Error(log.format("Constant value of unsupported type", "value", value))
      }
      this._nodes.set(id, node = this.ctx.types.createNode(this, id, {type, value}))
    }
    return node.getOutput(undefined, defaultValue)
  }

  protected _getOrCreateNode (idOrConfig :string|NodeConfig) :Node|undefined {
    if (typeof idOrConfig === "string") return this._nodes.get(idOrConfig)
    const id = getInlineNodeId(idOrConfig)
    let node = this._nodes.get(id)
    if (!node) this._nodes.set(id, node = this.ctx.types.createNode(this, id, idOrConfig))
    return node
  }

  /** Updates the state of the graph.  Should be called once per frame. */
  update (clock :Clock) {
    this._clock.emit(clock)
  }

  /** Returns a JSON representation of the graph. */
  toJSON () :GraphConfig {
    const json = {}
    for (const [key, node] of this._nodes) {
      json[key] = node.toJSON()
    }
    return json
  }

  /** Loads a JSON representation of the graph. */
  fromJSON (json :GraphConfig) {
    // remove any nodes not present in the configuration
    for (const [key, node] of this._nodes) {
      if (!json[key]) {
        delete this.config[key]
        this._nodes.delete(key)
        node.dispose()
      }
    }
    // add any new nodes, update existing
    for (const key in json) {
      const config = json[key]
      let node = this._nodes.get(key)
      if (node) {
        if (node.config.type === config.type) {
          node.fromJSON(config)
          continue
        }
        // if the type changed, we must dispose and recreate
        node.dispose()
      }
      node = this.ctx.types.createNode(this, key, this.config[key] = {type: config.type})
      this._nodes.set(key, node)
      node.fromJSON(config)
    }
    for (const node of this._nodes.values()) node.reconnect()
  }

  dispose () {
    for (const node of this._nodes.values()) {
      node.dispose()
    }
  }
}
