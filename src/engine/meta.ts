import {MutableMap} from "../core/rcollect"
import {Configurable} from "./game"

/** The metadata associated with a viewable/editable property. */
export interface PropertyMeta {
  type :string
  constraints :PropertyConstraints
}

/** Base interface for property constraints. */
export interface PropertyConstraints {
  /** If true, this property is read-only. */
  readonly? :boolean
  /** If true, this property should not be persisted. */
  transient? :boolean
  /** If false, this property should not be shown in the editor interface. */
  editable? :boolean
  /** Extra bits may apply to specific property types. */
  [extra :string] :any
}

/** The metadata for a configurable type. */
export interface ConfigurableMeta {
  properties :MutableMap<string, PropertyMeta>
}

/** Marks the decorated field as a viewable/editable property. */
export function property (type :string, constraints :PropertyConstraints = {}) {
  return (prototype :Configurable, name :string) => {
    getConfigurableMeta(prototype).properties.set(name, {type, constraints})
  }
}

const configurableMeta = new Map<Configurable, ConfigurableMeta>()

/** Retrieves the metadata stored for a configurable prototype.
  * @param prototype the configurable prototype of interest.
  * @return the stored metadata. */
export function getConfigurableMeta (prototype :Configurable) :ConfigurableMeta {
  let meta = configurableMeta.get(prototype)
  if (!meta) {
    configurableMeta.set(prototype, meta = {properties: MutableMap.local()})
    const superMeta = configurableMeta.get(Object.getPrototypeOf(prototype))
    if (superMeta) {
      for (const [property, propertyMeta] of superMeta.properties) {
        meta.properties.set(property, propertyMeta)
      }
    }
  }
  return meta
}
