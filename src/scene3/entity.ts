import {
  BoxBufferGeometry,
  Color,
  Group,
  Mesh,
  MeshToonMaterial,
  SphereBufferGeometry,
} from "three"

import {Component, Domain, EntityConfig, ID, Matcher, System} from "../entity/entity"
import {TransformComponent} from "../space/entity"
import {createHeightfieldGeometry} from "./terrain"

/** Configures the geometry and (optionally) material of a mesh. */
export interface MeshConfig {
  geometry :GeometryConfig
  material? :MaterialConfig
}

/** Base class for geometry configs. */
export interface GeometryConfig {
  type :string
}

/** Configuration for sphere buffer geometry. */
export interface SphereBufferConfig extends GeometryConfig {
  type :"sphereBuffer"
}

/** Configuration for box buffer geometry. */
export interface BoxBufferConfig extends GeometryConfig {
  type :"boxBuffer"
}

/** Configuration for heightfield buffer geometry. */
export interface HeightfieldBufferConfig extends GeometryConfig {
  type :"heightfieldBuffer"
  data :Float32Array[]
  elementSize :number

}

/** Base class for material configs. */
export interface MaterialConfig {
  type :string
}

/** Configuration for toon material. */
export interface ToonMaterialConfig extends MaterialConfig {
  type :"toon"
  color :Color | string | undefined
}

/** Manages a group of meshes based on [[TransformComponent]] for 3D transform, a
 * geometry component, and an optional material component. Users of this system must call
 * [[MeshSystem.update]] on every frame. */
export class MeshSystem extends System {
  readonly group :Group = new Group()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly mesh :Component<Mesh>) {
    super(domain, Matcher.hasAllC(trans.id, mesh.id))
  }

  update () {
    this.onEntities(id => {
      const mesh = this.mesh.read(id)
      this.trans.readPosition(id, mesh.position)
      this.trans.readQuaternion(id, mesh.quaternion)
      this.trans.readScale(id, mesh.scale)
    })
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    const meshConfig :MeshConfig = config.components[this.mesh.id]
    const mesh = new Mesh(createGeometry(meshConfig.geometry),
                          maybeCreateMaterial(meshConfig.material))
    this.mesh.update(id, mesh)
    this.group.add(mesh)
  }

  protected deleted (id :ID) {
    this.group.remove(this.mesh.read(id))
    super.deleted(id)
  }
}

function maybeCreateMaterial (materialConfig? :MaterialConfig) {
  if (!materialConfig) {
    return
  }
  switch (materialConfig.type) {
    case "toon":
      const toonConfig = materialConfig as ToonMaterialConfig
      const params :{ [name :string] :any } = {}
      if (toonConfig.color) {
        params.color = toonConfig.color
      }
      return new MeshToonMaterial(params)
    default:
      throw new Error("Unknown material type: " + materialConfig.type)
  }
}

function createGeometry (geometryConfig :GeometryConfig) {
  switch (geometryConfig.type) {
    case "sphereBuffer":
      return new SphereBufferGeometry()
    case "boxBuffer":
      return new BoxBufferGeometry()
    case "heightfieldBuffer":
      const hfConfig = geometryConfig as HeightfieldBufferConfig
      return createHeightfieldGeometry(hfConfig.data, hfConfig.elementSize, 5)
    default:
      throw new Error("Unknown geometry type: " + geometryConfig.type)
  }
}
