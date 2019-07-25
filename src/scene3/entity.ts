import {
  BoxBufferGeometry,
  Color,
  Group,
  Mesh,
  MeshToonMaterial,
  Object3D,
  SphereBufferGeometry,
} from "three"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader"

import {Subject, Value} from "../core/react"
import {NoopRemover} from "../core/util"
import {Component, Domain, EntityConfig, ID, Matcher, System} from "../entity/entity"
import {TransformComponent} from "../space/entity"
import {createHeightfieldGeometry} from "./terrain"

/** Base class for 3D object configs. */
export interface Object3DConfig {
  type :string
}

/** Configures an object loaded from a GLTF resource. */
export interface GLTFConfig extends Object3DConfig {
  type :"gltf"
  url :string
}

/** Configures the geometry and (optionally) material of a mesh. */
export interface MeshConfig extends Object3DConfig {
  type :"mesh"
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

/** Manages a group of scene nodes based on [[TransformComponent]] for 3D transform and a scene
 * object component. Users of this system must call [[SceneSystem.update]] on every frame. */
export class SceneSystem extends System {

  /** The group that holds all of our objects. */
  readonly group :Group = new Group()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly obj :Component<Object3D>) {
    super(domain, Matcher.hasAllC(trans.id, obj.id))
  }

  update () {
    this.onEntities(id => {
      const obj = this.obj.read(id)
      this.trans.readPosition(id, obj.position)
      this.trans.readQuaternion(id, obj.quaternion)
      this.trans.readScale(id, obj.scale)
    })
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    createObject3D(config.components[this.obj.id]).onValue(obj => {
      this.obj.update(id, obj)
      this.group.add(obj)
    })
  }

  protected deleted (id :ID) {
    this.group.remove(this.obj.read(id))
    super.deleted(id)
  }
}

function createObject3D (objectConfig: Object3DConfig) :Subject<Object3D> {
  switch (objectConfig.type) {
    case "gltf": {
      const gltfConfig = objectConfig as GLTFConfig
      const loader = new GLTFLoader()
      return Subject.derive(dispatch => {
        loader.load(
          gltfConfig.url,
          (gltf :{[key :string]: any}) => dispatch(gltf.scene),
          () => {},
          () => {
            // TODO: error object
          }
        )
        return NoopRemover
      })
    }
    case "mesh":
      const meshConfig = objectConfig as MeshConfig
      return Value.constant(new Mesh(createGeometry(meshConfig.geometry),
                                     maybeCreateMaterial(meshConfig.material)))
    default:
      throw new Error("Unknown Object3D type: " + objectConfig.type)
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
