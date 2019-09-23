import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {ChangeFn, Mutable, Value} from "../core/react"
import {MutableMap} from "../core/rcollect"
import {PMap, getValue, log} from "../core/util"
import {Graph, GraphConfig} from "./graph"
import {
  EdgeMeta, InputEdgeMeta, PropertyMeta, inputEdge,
  outputEdge, property, setEnumMeta,
} from "./meta"
import {CategoryNode, InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Switches to true after a number of seconds have passed. */
abstract class TimeoutConfig implements NodeConfig {
  type = "timeout"
  @property() seconds = 0
  @inputEdge("boolean") start = undefined
  @outputEdge("boolean") output = undefined
}

class TimeoutNode extends Node {
  private _output = Mutable.local(false)
  private _timeout? :number

  constructor (graph :Graph, id :string, readonly config :TimeoutConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.start, true).onValue(start => {
      if (!start) return
      this._output.update(false)
      window.clearTimeout(this._timeout)
      this._timeout = window.setTimeout(() => this._output.update(true), this.config.seconds * 1000)
    }))
  }

  dispose () {
    super.dispose()
    window.clearTimeout(this._timeout)
  }

  protected _createOutput () {
    return this._output
  }
}

/** Pulses true at regular intervals. */
abstract class IntervalConfig implements NodeConfig {
  type = "interval"
  @property() seconds = 0
  @inputEdge("boolean") start = undefined
  @outputEdge("boolean") output = undefined
}

class IntervalNode extends Node {
  private _output = Mutable.local(false)
  private _interval? :number

  constructor (graph :Graph, id :string, readonly config :IntervalConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.start, true).onValue(start => {
      if (!start) return
      window.clearInterval(this._interval)
      this._interval = window.setInterval(
        () => {
          this._output.update(true)
          this._output.update(false)
        },
        this.config.seconds * 1000,
      )
    }))
  }

  dispose () {
    super.dispose()
    window.clearInterval(this._interval)
  }

  protected _createOutput () {
    return this._output
  }
}

/** Stores a value, updating from the value input when the store input is set. */
abstract class LatchConfig implements NodeConfig {
  type = "latch"
  @inputEdge("boolean") store = undefined
  @inputEdge("any") value = undefined
  @outputEdge("any") output = undefined
}

class Latch extends Node {

  constructor (graph :Graph, id :string, readonly config :LatchConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    let stored :any = defaultValue
    return Value
      .join2(
        this.graph.getValue(this.config.store, false),
        this.graph.getValue(this.config.value, defaultValue),
      )
      .map(([store, value]) => {
        if (store) stored = value
        return stored
      })
  }
}

/** Provides the time, elapsed, and dt (default) fields from the clock. */
abstract class ClockConfig implements NodeConfig {
  type = "clock"
  @outputEdge("number") time = undefined
  @outputEdge("number") elapsed = undefined
  @outputEdge("number", true) dt = undefined
}

class ClockNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ClockConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const field :(clock :Clock) => number =
      (name === "time" || name === "elapsed") ? clock => clock[name] : clock => clock.dt
    return this.graph.clock.map(field).toValue(0, refEquals)
  }
}

/** An encapsulated graph. */
abstract class SubgraphConfig implements NodeConfig {
  type = "subgraph"
  title? :string
  graph :GraphConfig = {}
}

export class Subgraph extends Node {
  readonly containedGraph :Graph

  private _containedOutputs :Map<string, Value<InputEdge<any>>> = new Map()
  private _title :Mutable<string>
  private _propertiesMeta = MutableMap.local<string, PropertyMeta>()
  private _inputsMeta = MutableMap.local<string, InputEdgeMeta>()
  private _outputsMeta = MutableMap.local<string, EdgeMeta>()

  get title () :Value<string> {
    return this._title
  }

  get propertiesMeta () {
    return this._propertiesMeta
  }

  get inputsMeta () {
    return this._inputsMeta
  }

  get outputsMeta () {
    return this._outputsMeta
  }

  constructor (graph :Graph, id :string, readonly config :SubgraphConfig) {
    super(graph, id, config)

    const subctx = Object.create(graph.ctx)
    subctx.subgraph = this
    this._title = this.getProperty("title", config.type) as Mutable<string>
    this._disposer.add(this.containedGraph = new Graph(subctx, config.graph))
    // we don't bother with disposers for the values that we listen to on the contained graph
    // because the contained graph will never outlive this node
    const maybeSetMeta = (node :Node) => {
      let currentName :string|undefined
      switch (node.config.type) {
        case "property":
          Value
            .join(
              node.getProperty<string>("name"),
              node.getProperty<string>("propType"),
              node.getProperty<any>("defaultValue"),
            )
            .onValue(([name, propType, defaultValue]) => {
              if (currentName !== undefined) this._propertiesMeta.delete(currentName)
              this._propertiesMeta.set(
                currentName = name!,
                {
                  type: propType!,
                  defaultValue: getValue(defaultValue, propertyDefaults[propType!]),
                },
              )
            })
          break
        case "input":
          node.getProperty<string>("name").onValue(name => {
            if (currentName !== undefined) this._inputsMeta.delete(currentName)
            this._inputsMeta.set(currentName = name!, {type: "any"}) // TODO: infer?
          })
          break
        case "output":
          node.getProperty<string>("name").onValue(name => {
            if (currentName !== undefined) {
              this._outputsMeta.delete(currentName)
              this._containedOutputs.delete(currentName)
            }
            this._outputsMeta.set(currentName = name!, {type: "any"}) // TODO: infer?
            this._containedOutputs.set(currentName, node.getProperty("input"))
          })
          break
      }
    }
    for (const node of this.containedGraph.nodes.values()) maybeSetMeta(node)
    this.containedGraph.nodes.onChange(change => {
      if (change.type === "set") {
        maybeSetMeta(change.value)
      } else { // change.type === "deleted"
        let map :MutableMap<string, any>
        switch (change.prev.config.type) {
          case "property": map = this._propertiesMeta ; break
          case "input": map = this._inputsMeta ; break
          case "output":
            map = this._outputsMeta
            this._containedOutputs.delete(change.prev.config.name)
            break
          default: return
        }
        map.delete(change.prev.config.name)
      }
    })
    this._disposer.add(graph.clock.onValue(clock => this.containedGraph.update(clock)))
  }

  reconnect () {
    // no-op; we handle everything dynamically
  }

  connect () {
    this.containedGraph.connect()
  }

  toJSON () :NodeConfig {
    const json = super.toJSON()
    json.graph = this.containedGraph.toJSON()
    return json
  }

  fromJSON (json :NodeConfig) {
    super.fromJSON(json)
    this.containedGraph.fromJSON(json.graph)
    return json
  }

  protected _createOutput (name :string, defaultValue :any) {
    let edge :Value<InputEdge<any>>|undefined
    if (name === undefined) {
      if (this._containedOutputs.size !== 1) throw new Error("No default output")
      edge = this._containedOutputs.values().next().value
    } else {
      edge = this._containedOutputs.get(name)
    }
    if (edge === undefined) throw new Error("Unknown output: " + name)
    return edge.switchMap(edge => this.containedGraph.getValue(edge, defaultValue))
  }
}

/** Maintains a registry of common subgraphs. */
export class SubgraphRegistry {
  readonly root = new CategoryNode("")
  private _graphConfigs :Map<string, GraphConfig> = new Map()

  constructor (...regs :((registry :SubgraphRegistry) => void)[]) {
    for (const reg of regs) {
      reg(this)
    }
  }

  /** Registers a group of subgraph configs.
    * @param categories the category path under which to list the subgraphs, or undefined to avoid
    * listing.
    * @param subgraphs the map from subgraph names to graph configs.
    */
  registerSubgraphs (
    categories :string[]|undefined,
    subgraphs :{ [name :string]: GraphConfig },
  ) {
    const category = categories && this.root.getCategoryNode(categories)
    for (const name in subgraphs) {
      if (category) category.addLeafNode(name)
      this._graphConfigs.set(name, subgraphs[name])
    }
  }

  /** Creates and returns a new node config for a subgraph of the specified registered name.
    * @param [props] optional additional properties to add to the node config. */
  createNodeConfig (name :string, props? :PMap<any>) :NodeConfig {
    const graphConfig = this._graphConfigs.get(name)
    if (!graphConfig) throw new Error("Unknown subgraph: " + name)
    return {
      ...props,
      type: "subgraph",
      title: name,
      graph: graphConfig,
    }
  }
}

/** The different property types available. */
export type PropertyType = string
const propertyTypes :string[] = []
const propertyDefaults :PMap<any> = {}
setEnumMeta("PropertyType", propertyTypes)

/** Adds a set of types (and their default values) to the property type enum. */
export function addPropertyTypes (defaults :PMap<any>) {
  for (const type in defaults) {
    if (propertyTypes.indexOf(type) === -1) propertyTypes.push(type)
    propertyDefaults[type] = defaults[type]
  }
}
addPropertyTypes({number: 0, boolean: false, string: ""})

/** A property of a subgraph. */
abstract class PropertyConfig implements NodeConfig {
  type = "property"
  @property() name = ""
  @property("PropertyType") propType = "number"
  defaultValue = undefined // TODO: editing this will depend on the propType
  @outputEdge("any") output = undefined
}

class Property extends Node {

  constructor (graph :Graph, id :string, readonly config :PropertyConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const subgraph = this.graph.ctx.subgraph
    if (!subgraph) throw new Error("Property node used outside subgraph")
    return subgraph.getProperty(this.config.name)
  }
}

/** An input to a subgraph. */
abstract class InputConfig implements NodeConfig {
  type = "input"
  @property() name = ""
  @outputEdge("any") output = undefined
}

class Input extends Node {

  constructor (graph :Graph, id :string, readonly config :InputConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    const subgraph = this.graph.ctx.subgraph
    if (!subgraph) throw new Error("Input node used outside subgraph")
    return subgraph.graph.getValue(subgraph.config[this.config.name], defaultValue)
  }
}

/** An output from a subgraph. */
abstract class OutputConfig implements NodeConfig {
  type = "output"
  @property() name = ""
  @inputEdge("any") input = undefined
}

class Output extends Node {

  constructor (graph :Graph, id :string, readonly config :OutputConfig) {
    super(graph, id, config)
  }
}

/** Logs its input to the console. */
abstract class LogConfig implements NodeConfig {
  type = "log"
  @property() message = ""
  @inputEdge("any") input = undefined
}

class Log extends Node {

  constructor (graph :Graph, id :string, readonly config :LogConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, undefined).onValue(
      value => log.info(this.config.message || "", "value", value),
    ))
  }
}

/** Extracts a property of the (object) input. */
abstract class GetPropertyConfig implements NodeConfig {
  type = "getProperty"
  @property() name = ""
  @inputEdge("object") input = undefined
  @outputEdge("any") output = undefined
}

class GetProperty extends Node {

  constructor (graph :Graph, id :string, readonly config :GetPropertyConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    return this.graph.getValue(this.config.input, {}).map(value => value[this.config.name])
  }
}

/** Calls a callback whenever the input changes. */
abstract class OnChangeConfig implements NodeConfig {
  type = "onChange"
  @property("ChangeFn") callback = undefined
  @inputEdge("any") input = undefined
}

class OnChange extends Node {

  constructor (graph :Graph, id :string, readonly config :OnChangeConfig) {
    super(graph, id, config)
  }

  connect () {
    const callback = this.config.callback as any
    if (callback instanceof Function) {
      const changeFn = callback as ChangeFn<any>
      this._disposer.add(this.graph.getValue(this.config.input, undefined).onChange(changeFn))
    } else {
      log.warn("Callback does not appear to be a Function")
    }
  }
}

/** Emits a constant string. */
abstract class StringConfig implements NodeConfig {
  type = "string"
  @property() value = ""
  @outputEdge("string") output = undefined
}

class StringNode extends Node {

  constructor (graph :Graph, id :string, readonly config :StringConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || "")
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUtilNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["util"], {
    timeout: TimeoutNode,
    interval: IntervalNode,
    latch: Latch,
    clock: ClockNode,
    subgraph: Subgraph,
    property: Property,
    input: Input,
    output: Output,
    log: Log,
    getProperty: GetProperty,
    string: StringNode,
  })
  registry.registerNodeTypes(undefined, {
    onChange: OnChange,
  })
}
