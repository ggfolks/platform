import {PMap} from "../core/util"
import {NodeConfig} from "./node"

/** The metadata associated with a graph edge. */
export interface EdgeMeta {

  /** The edge type. */
  type :string
}

/** The metadata associated with an input edge (or multiple ones). */
export interface InputEdgeMeta extends EdgeMeta {

  /** Whether or not the input accepts multiple connections. */
  multiple :boolean
}

/** The edge metadata for a node type. */
export interface NodeMeta {

  /** Maps input edge names to metadata. */
  inputs :PMap<InputEdgeMeta>

  /** Maps output edge names to metadata. */
  outputs :PMap<EdgeMeta>
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
export function outputEdge (type :string) {
  return (prototype :NodeConfig, name :string) => {
    let instance = new (prototype as any).constructor()
    getNodeMeta(instance.type).outputs[name] = {type}
  }
}

const nodeMeta :PMap<NodeMeta> = {}

/** Returns the metadata for the specified node type. */
export function getNodeMeta (type :string) :NodeMeta {
  let meta = nodeMeta[type]
  if (!meta) meta = nodeMeta[type] = {inputs: {}, outputs: {}}
  return meta
}
