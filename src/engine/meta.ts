import {MutableMap} from "../core/rcollect"
import {Component} from "./game"

/** The metadata associated with a viewable/editable property. */
export interface PropertyMeta {
  type :string
  constraints? :PropertyConstraints
}

/** Base interface for property constraints. */
export interface PropertyConstraints {
  readonly? :boolean
  [extra :string] :any
}

/** The metadata for a component type. */
export interface ComponentMeta {
  properties :MutableMap<string, PropertyMeta>
}

/** Marks the decorated field as a viewable/editable property. */
export function property (type :string, constraints? :PropertyConstraints) {
  return (prototype :Component, name :string) => {
    getComponentMeta(prototype).properties.set(name, {type, constraints})
  }
}

const componentMeta = new Map<Component, ComponentMeta>()

/** Retrieves the metadata stored for a component prototype.
  * @param prototype the component prototype of interest.
  * @return the stored metadata. */
export function getComponentMeta (prototype :Component) :ComponentMeta {
  let meta = componentMeta.get(prototype)
  if (!meta) componentMeta.set(prototype, meta = {properties: MutableMap.local()})
  return meta
}
