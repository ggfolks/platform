import {MutableMap} from "../core/rcollect"
import {PropertyConstraints, PropertyMeta} from "../graph/meta"
import {Configurable} from "./game"

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
    for (
      let prototypePrototype = Object.getPrototypeOf(prototype);
      prototypePrototype;
      prototypePrototype = Object.getPrototypeOf(prototypePrototype)
    ) {
      const superMeta = configurableMeta.get(prototypePrototype)
      if (superMeta) {
        for (const [property, propertyMeta] of superMeta.properties) {
          meta.properties.set(property, propertyMeta)
        }
        break
      }
    }
  }
  return meta
}
