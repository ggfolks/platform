import {MutableMap} from "../core/rcollect"
import {PMap} from "../core/util"
import {NodeConfig} from "./node"

/** The metadata associated with a viewable/editable property. */
export interface PropertyMeta {
  type :string
  defaultValue :any
  constraints? :PropertyConstraints
}

/** Base interface for property constraints. */
export interface PropertyConstraints {
  [extra :string] :any
}

/** Constraints on numeric properties. */
export interface NumberConstraints {
  min? :number
  max? :number
  maxDecimals? :number
  wheelStep? :number
}

/** Constraints on select properties. */
export interface SelectConstraints {
  /** Options can be either some labels mapped to values, or just labels. */
  options: Map<string,any>|string[]
}

/** The metadata associated with a graph edge. */
export interface EdgeMeta {
  type :string
}

/** The metadata associated with an input edge (or multiple ones). */
export interface InputEdgeMeta extends EdgeMeta {
  multiple? :boolean
}

/** The metadata associated with an output edge. */
export interface OutputEdgeMeta extends EdgeMeta {
  isDefault? :boolean
}

/** The edge metadata for a node type. */
export interface NodeMeta {
  properties :MutableMap<string, PropertyMeta>
  inputs :MutableMap<string, InputEdgeMeta>
  outputs :MutableMap<string, OutputEdgeMeta>
}

/** Marks the decorated field as a viewable/editable property. */
export function property (type? :string, constraints? :PropertyConstraints) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    const defaultValue = instance[name]
    if (type === undefined) {
      type = typeof defaultValue
      if (type === "object" && defaultValue !== null) type = defaultValue.constructor.name as string
    }
    getNodeMetaByPrototype(prototype, instance.type).properties.set(
      name,
      {type, defaultValue, constraints},
    )
  }
}

/** Marks the decorated field as an input edge of the specified type. */
export function inputEdge (type :string) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMetaByPrototype(prototype, instance.type).inputs.set(name, {type, multiple: false})
  }
}

/** Marks the decorated field as an array of multiple input edges. */
export function inputEdges (type :string) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMetaByPrototype(prototype, instance.type).inputs.set(name, {type, multiple: true})
  }
}

/** Marks the decorated field as an output edge of the specified type. */
export function outputEdge (type :string, isDefault :boolean = false) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMetaByPrototype(prototype, instance.type).outputs.set(name, {type, isDefault})
  }
}

const nodeMetaByPrototype = new Map<NodeConfig, NodeMeta>()
const nodeMeta :PMap<NodeMeta> = {}

function getNodeMetaByPrototype (prototype :NodeConfig, type :string) :NodeMeta {
  let meta = nodeMetaByPrototype.get(prototype)
  if (!meta) nodeMetaByPrototype.set(prototype, meta = nodeMeta[type] = {
    properties: MutableMap.local(),
    inputs: MutableMap.local(),
    outputs: MutableMap.local(),
  })
  return meta
}

/** Returns the metadata for the specified node type. */
export function getNodeMeta (type :string) :NodeMeta {
  let meta = nodeMeta[type]
  if (!meta) meta = nodeMeta[type] = {
    properties: MutableMap.local(),
    inputs: MutableMap.local(),
    outputs: MutableMap.local(),
  }
  return meta
}

type NodeConfigConstructor = Function & { prototype: NodeConfig }

/** Activates a node configuration class, ensuring that its metadata is returned when metadata is
  * requested by string.  This is necessary because there are (temporarily) different nodes with
  * the same type identifier as we transition between systems.
  * @param constructors the constructors of the config classes to activate. */
export function activateNodeConfigs (...constructors :NodeConfigConstructor[]) {
  for (const constructor of constructors) {
    let instance = new (constructor as any)()
    nodeMeta[instance.type] = getNodeMetaByPrototype(constructor.prototype, instance.type)
  }
}

/** The metadata associated with an enum type. */
export interface EnumMeta {
  values :string[]
}

const enumMeta :PMap<EnumMeta> = {}

/** Registers an enum type.
  * @param type the name of the type.
  * @param values the values that the type can take.
  */
export function setEnumMeta (type :string, values :string[]) {
  enumMeta[type] = {values}
}

/** Returns the metadata for the specified enum type, if registered. */
export function getEnumMeta (type :string) :EnumMeta|undefined {
  return enumMeta[type]
}
