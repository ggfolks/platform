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
  properties :PMap<PropertyMeta>
  inputs :PMap<InputEdgeMeta>
  outputs :PMap<OutputEdgeMeta>
}

/** Marks the decorated field as a viewable/editable property. */
export function property (type? :string, constraints? :PropertyConstraints) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    const defaultValue = instance[name]
    if (type === undefined) {
      type = typeof defaultValue
    }
    getNodeMeta(instance.type).properties[name] = {type, defaultValue, constraints}
  }
}

/** Marks the decorated field as an input edge of the specified type. */
export function inputEdge (type :string) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMeta(instance.type).inputs[name] = {type, multiple: false}
  }
}

/** Marks the decorated field as an array of multiple input edges. */
export function inputEdges (type :string) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMeta(instance.type).inputs[name] = {type, multiple: true}
  }
}

/** Marks the decorated field as an output edge of the specified type. */
export function outputEdge (type :string, isDefault :boolean = false) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMeta(instance.type).outputs[name] = {type, isDefault}
  }
}

const nodeMeta :PMap<NodeMeta> = {}

/** Returns the metadata for the specified node type. */
export function getNodeMeta (type :string) :NodeMeta {
  let meta = nodeMeta[type]
  if (!meta) meta = nodeMeta[type] = {properties: {}, inputs: {}, outputs: {}}
  return meta
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
