import {refEquals} from "../core/data"
import {ChangeFn, Mutable, Value, addListener, dispatchChange} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Disposable, Disposer, Noop, NoopRemover, PMap, getValue} from "../core/util"
import {Graph, getConstantOrValueNodeId} from "./graph"
import {InputEdgeMeta, OutputEdgeMeta, PropertyMeta, getNodeMeta} from "./meta"
import {Subgraph, SubgraphRegistry} from "./util"

/** Configuration shared by all [[Node]]s. */
export interface NodeConfig {
  type :string
  position? :[number, number]
  // this allows NodeConfig to contain "extra" stuff that TypeScript will ignore
  [extra :string] :any
}

/** Describes the input of a node: a node ID, a node/output pair, or a static value. */
export type NodeInput<T> = string | [string, string] | T | Value<T> | QuotedValue<T>

/** Wraps a value so that we don't confuse it with a node ID or node/output pair. */
export type QuotedValue<T> = {value: T}

/** Describes the connection state of a single node input. */
export type InputEdge<T> = undefined | null | NodeInput<T>

/** Describes the connection states of an array of node inputs. */
export type InputEdges<T> = undefined | null | InputEdge<T>[]

/** Used to describe output edges, whose connection states are omitted from configs. */
export type OutputEdge<T> = undefined

/** Base interface for node contexts. */
export interface NodeContext {
  types :NodeTypeRegistry
  subgraphs :SubgraphRegistry
  subgraph? :Subgraph
  // this allows NodeContext to contain "extra" stuff that TypeScript will ignore
  [extra :string] :any
}

/** Parent class for all nodes. */
export abstract class Node implements Disposable {
  protected _disposer = new Disposer()
  private _properties :Map<string, Mutable<any>> = new Map()
  private _outputs :Map<string, Value<any>> = new Map()
  private _wrappedOutputs :Map<string, WrappedValue<any>> = new Map()
  private _defaultOutputKey? :string

  constructor (readonly graph :Graph, readonly id :string, readonly config :NodeConfig) {}

  /** The node's title (usually just the type). */
  get title () :Value<string> {
    return Value.constant(this.config.type)
  }

  /** The metadata for the node's viewable/editable properties. */
  get propertiesMeta () :PMap<PropertyMeta> {
    return getNodeMeta(this.config.type).properties
  }

  /** The metadata for the node's inputs. */
  get inputsMeta () :PMap<InputEdgeMeta> {
    return getNodeMeta(this.config.type).inputs
  }

  /** The metadata for the node's outputs. */
  get outputsMeta () :PMap<OutputEdgeMeta> {
    return getNodeMeta(this.config.type).outputs
  }

  /** The key of the default output, or the empty string if none. */
  get defaultOutputKey () :string {
    if (this._defaultOutputKey === undefined) {
      this._defaultOutputKey = ""
      const outputs = this.outputsMeta
      for (const outputKey in outputs) {
        if (outputs[outputKey].isDefault) {
          this._defaultOutputKey = outputKey
          break
        }
        // first output key is default if not otherwise specified
        if (!this._defaultOutputKey) this._defaultOutputKey = outputKey
      }
    }
    return this._defaultOutputKey
  }

  /** Returns a reactive view of the specified property.
    * @param [overrideDefault] an optional default to override the one in the metadata, if any. */
  getProperty<T> (name :string, overrideDefault? :any) :Mutable<T|undefined> {
    let property = this._properties.get(name)
    if (!property) {
      const meta = this.propertiesMeta[name]
      const defaultValue = getValue(overrideDefault, meta && meta.defaultValue)
      let changeFn :ChangeFn<T|undefined> = Noop
      this._properties.set(name, property = Mutable.deriveMutable(
        dispatch => {
          changeFn = dispatch
          return Noop
        },
        () => getValue(this.config[name], defaultValue),
        (value :T|undefined) => {
          const baseValue = this.config[name]
          const oldValue = getValue(baseValue, defaultValue)
          if (value === undefined || value === null) {
            if (baseValue === undefined) return
            delete this.config[name]
            changeFn(defaultValue, oldValue)
          } else {
            if (oldValue === value) return
            this.config[name] = value
            changeFn(value, oldValue)
          }
        },
        refEquals,
      ))
    }
    return property
  }

  /** Returns the value corresponding to the identified output, or the default if none. */
  getOutput<T> (name :string | undefined, defaultValue :T) :Value<T> {
    // create outputs lazily
    const outputKey = name || this.defaultOutputKey
    let output = this._outputs.get(outputKey)
    if (!output) {
      // it may be that our call to _createOutput ends up triggering a recursive call to getOutput
      // on this node.  in that case, we have a cycle.  when that happens, we use the value from
      // the previous frame
      let current = this._maybeOverrideDefaultValue(outputKey, defaultValue)
      this._outputs.set(outputKey, Value.deriveValue(
        refEquals,
        dispatch => this.graph.clock.onEmit(() => {
          const previous = current
          current = (this._outputs.get(outputKey) as Value<T>).current
          if (current !== previous) dispatch(current, previous)
        }),
        () => current
      ))
      let wrapped = this._wrappedOutputs.get(outputKey)
      if (!wrapped) {
        this._wrappedOutputs.set(
          outputKey,
          wrapped = new WrappedValue(this._createOutput(outputKey, defaultValue), defaultValue),
        )
      }
      this._outputs.set(outputKey, output = wrapped)
    }
    return output
  }

  /** Reconnects the node after one of the inputs has changed. */
  reconnect () {
    // clear the outputs before recreating the wrapped outputs in case recreating creates a loop,
    // in which case we need the intermediate value created in getOutput
    this._disposer.dispose()
    this._outputs.clear()
    for (const [name, wrapped] of this._wrappedOutputs) {
      wrapped.update(this._createOutput(name, wrapped.defaultValue))
    }
    this.connect()
  }

  /** Connects and initializes the node. */
  connect () {}

  /** Returns a JSON representation of this node. */
  toJSON () :NodeConfig {
    const json = Object.assign({}, this.config)
    const inputsMeta = this.inputsMeta
    for (const inputKey in inputsMeta) {
      const value = json[inputKey]
      if (inputsMeta[inputKey].multiple) {
        if (Array.isArray(value)) {
          json[inputKey] = value.map(inputToJSON)
        }
      } else {
        json[inputKey] = inputToJSON(value)
      }
    }
    return json
  }

  /** Applies a JSON representation of this node. */
  fromJSON (json :NodeConfig) {
    Object.assign(this.config, json)
  }

  dispose () {
    this._disposer.dispose()
  }

  /** Gives subclasses a chance to overrule the default value provided by the output consumer.  For
   * example, in a multiply node, 1 makes a better default than zero. */
  protected _maybeOverrideDefaultValue (name :string, defaultValue :any) {
    return defaultValue
  }

  protected _createOutput (name :string, defaultValue :any) :Value<any> {
    throw new Error("Unknown output " + name)
  }
}

function inputToJSON (input :InputEdge<any>) {
  return input === undefined || input === null
    ? null
    : typeof input === "string" || Array.isArray(input)
    ? input
    : getConstantOrValueNodeId(input)
}

/** Wraps a value so that we can swap it out after creating it. */
export class WrappedValue<T> extends Value<T> {
  private readonly _listeners :ChangeFn<T>[] = []
  private _disconnect = NoopRemover

  constructor (private _wrapped :Value<T>, readonly defaultValue :T) {
    super(
      refEquals,
      listener => {
        const needConnect = this._listeners.length === 0
        const remover = addListener(this._listeners, listener)
        if (needConnect) this._connect()
        return () => { remover() ; this._checkEmpty() }
      },
      () => this._wrapped.current,
    )
  }

  /** Updates the wrapped value, notifying listeners on change. */
  update (wrapped :Value<T>) {
    const oldValue = this._wrapped.current
    this._disconnect()
    this._wrapped = wrapped
    if (this._listeners.length > 0) {
      this._connect()
      const value = this._wrapped.current
      if (value !== oldValue) this._dispatch(value, oldValue)
    }
  }

  private _connect () {
    this._disconnect = this._wrapped.onChange((value, oldValue) => this._dispatch(value, oldValue))
  }

  private _dispatch (value :T, oldValue :T) {
    if (dispatchChange(this._listeners, value, oldValue)) this._checkEmpty()
  }

  private _checkEmpty () {
    if (this._listeners.length === 0) {
      this._disconnect()
      this._disconnect = NoopRemover
    }
  }
}

/** Base config for operators with N inputs and one output. */
export interface OperatorConfig<T> extends NodeConfig {
  inputs :InputEdges<T>
  output :OutputEdge<T>
}

export abstract class Operator<T> extends Node {

  constructor (graph :Graph, id :string, readonly config :OperatorConfig<T>) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph
      .getValues(this.config.inputs, this._defaultInputValue)
      .map(values => this._apply(values))
  }

  protected _maybeOverrideDefaultValue (name :string, defaultValue :any) {
    return this._defaultInputValue
  }

  protected abstract get _defaultInputValue () :T

  protected abstract _apply (values :T[]) :T
}

interface NodeConstructor<T extends NodeConfig> {
  new (graph :Graph, id :string, config :T): Node
}

/** Base class for nodes in the type registry. */
export class RegistryNode {
  constructor (readonly name :string) {}
}

/** A node representing a category of types (an internal node). */
export class CategoryNode extends RegistryNode {
  private readonly _children = MutableMap.local<string, RegistryNode>()

  get children () :RMap<string, RegistryNode> { return this._children }

  getCategoryNode (categories :string[]) :CategoryNode {
    if (categories.length === 0) return this
    const name = categories[0]
    let child = this._children.get(name)
    if (!(child instanceof CategoryNode)) {
      this._children.set(name, child = new CategoryNode(name))
    }
    const category = child as CategoryNode
    return category.getCategoryNode(categories.slice(1))
  }

  addLeafNode (name :string) {
    this._children.set(name, new LeafNode(name))
  }
}

/** A node representing a single type. */
export class LeafNode extends RegistryNode {}

/** Maintains a mapping from string node types to constructors. */
export class NodeTypeRegistry {
  readonly root = new CategoryNode("")
  private _constructors :Map<string, NodeConstructor<NodeConfig>> = new Map()

  constructor (...regs :((registry :NodeTypeRegistry) => void)[]) {
    for (const reg of regs) {
      reg(this)
    }
  }

  /** Registers a group of node type constructors.
    * @param categories the category path under which to list the nodes, or undefined to avoid
    * listing.
    * @param types the map from node type names to node constructors.
    */
  registerNodeTypes (
    categories :string[]|undefined,
    types :{ [type :string]: NodeConstructor<any> },
  ) {
    const category = categories && this.root.getCategoryNode(categories)
    for (const type in types) {
      if (category) category.addLeafNode(type)
      this._constructors.set(type, types[type] as NodeConstructor<NodeConfig>)
    }
  }

  /** Creates a node with the supplied id and configuration. */
  createNode (graph :Graph, id :string, config :NodeConfig) {
    const Constructor = this._constructors.get(config.type)
    if (!Constructor) {
      throw new Error("Unknown node type: " + config.type)
    }
    return new Constructor(graph, id, config)
  }
}
