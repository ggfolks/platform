import {
  AmbientLight,
  BoxBufferGeometry,
  Camera,
  Color,
  DirectionalLight,
  Intersection,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  Raycaster,
  Scene,
  SphereBufferGeometry,
  Vector2,
  WebGLRenderer,
} from "three"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader"

import {Subject} from "../core/react"
import {RMap} from "../core/rcollect"
import {NoopRemover} from "../core/util"
import {Pointer} from "../input/hand"
import {
  Component,
  Domain,
  EntityConfig,
  ID,
  IDSetComponent,
  Matcher,
  System,
} from "../entity/entity"
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

/** Configures a perspective camera. */
export interface PerspectiveCameraConfig extends Object3DConfig {
  type :"perspectiveCamera"
}

/** Base config for lights. */
export interface LightConfig extends Object3DConfig {
  color?: number
  intensity? :number
}

/** Configures a directional light. */
export interface DirectionalLightConfig extends LightConfig {
  type :"directionalLight"
}

/** Configures an ambient light. */
export interface AmbientLightConfig extends LightConfig {
  type :"ambientLight"
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

const rendererSize = new Vector2()
const pointerCoords = new Vector2()
const raycaster = new Raycaster()
const intersections :Intersection[] = []
const hoveredSet :Set<ID> = new Set()
const pressedSet :Set<ID> = new Set()

/** Manages a group of scene nodes based on [[TransformComponent]] for 3D transform and a scene
 * object component. Users of this system must call [[SceneSystem.update]] on every frame. */
export class SceneSystem extends System {

  /** The scene that holds all of our objects. */
  readonly scene :Scene = new Scene()

  private _cameras :Set<Camera> = new Set()
  private _pressedObjects :Map<number, Object3D> = new Map()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly obj :Component<Object3D>,
               readonly hovered? :IDSetComponent,
               readonly pressed? :IDSetComponent,
               readonly pointers? :RMap<number, Pointer>) {
    super(domain, Matcher.hasAllC(trans.id, obj.id))
  }

  /** Renders the scene. */
  render (renderer :WebGLRenderer) {
    this.update()
    renderer.getSize(rendererSize)
    const aspect = rendererSize.x / rendererSize.y
    if (this.hovered && this.pressed && this.pointers) {
      hoveredSet.clear()
      pressedSet.clear()
      for (const [identifier, pointer] of this.pointers) {
        // pressed objects stay hovered until the press ends
        const pressedObject = this._pressedObjects.get(identifier)
        if (pressedObject) {
          if (pointer.pressed) {
            this._maybeNoteHovered(identifier, true, pressedObject)
            continue
          } else {
            this._pressedObjects.delete(identifier)
          }
        }
        for (const camera of this._cameras) {
          raycaster.setFromCamera(
            pointerCoords.set(
              pointer.position[0] / rendererSize.x * 2 - 1,
              1 - pointer.position[1] / rendererSize.y * 2,
            ),
            camera,
          )
          intersections.length = 0
          let noted = false
          for (const intersection of raycaster.intersectObject(this.scene, true, intersections)) {
            let ancestor :Object3D | null = intersection.object
            while (ancestor && ancestor.userData.id === undefined) {
              ancestor = ancestor.parent
            }
            if (ancestor && this._maybeNoteHovered(identifier, pointer.pressed, ancestor)) {
              noted = true
              break
            }
          }
          // if we didn't hit anything else, "hover" on the camera
          if (!noted) this._maybeNoteHovered(identifier, pointer.pressed, camera)
        }
      }
      // remove any pressed objects whose pointers are no longer in the map
      for (const identifier of this._pressedObjects.keys()) {
        if (!this.pointers.has(identifier)) this._pressedObjects.delete(identifier)
      }
      this.hovered.updateAll(hoveredSet)
      this.pressed.updateAll(pressedSet)
    }
    for (const camera of this._cameras) {
      if (camera instanceof PerspectiveCamera && camera.aspect !== aspect) {
        camera.aspect = aspect
        camera.updateProjectionMatrix()
      }
      renderer.render(this.scene, camera)
    }
  }

  _maybeNoteHovered (identifier :number, pressed :boolean, object :Object3D) {
    const id = object.userData.id
    const comps = this.domain.entityConfig(id).components
    let noted = false
    if (comps[(this.hovered as IDSetComponent).id]) {
      hoveredSet.add(id)
      noted = true
    }
    if (pressed && comps[(this.pressed as IDSetComponent).id]) {
      pressedSet.add(id)
      this._pressedObjects.set(identifier, object)
      noted = true
    }
    return noted
  }

  /** Updates the transforms of the scene.  Called automatically by [[render]]. */
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
      // if this is the initial, default Object3D, it won't actually be in the scene;
      // otherwise, we're replacing the model with another
      const oldObj = this.obj.read(id)
      this.scene.remove(oldObj)
      if (oldObj instanceof Camera) this._cameras.delete(oldObj)
      obj.userData.id = id
      this.obj.update(id, obj)
      this.scene.add(obj)
      if (obj instanceof Camera) this._cameras.add(obj)
    })
  }

  protected deleted (id :ID) {
    const obj = this.obj.read(id)
    this.scene.remove(obj)
    if (obj instanceof Camera) this._cameras.delete(obj)
    super.deleted(id)
  }
}

function createObject3D (objectConfig: Object3DConfig) :Subject<Object3D> {
  switch (objectConfig.type) {
    case "gltf":
      const gltfConfig = objectConfig as GLTFConfig
      return loadGLTF(gltfConfig.url).map(original => original.clone())

    case "perspectiveCamera":
      return Subject.constant(new PerspectiveCamera())

    case "directionalLight":
      const dlConfig = objectConfig as DirectionalLightConfig
      return Subject.constant(new DirectionalLight(dlConfig.color, dlConfig.intensity))

    case "ambientLight":
      const alConfig = objectConfig as AmbientLightConfig
      return Subject.constant(new AmbientLight(alConfig.color, alConfig.intensity))

    case "mesh":
      const meshConfig = objectConfig as MeshConfig
      return Subject.constant(new Mesh(createGeometry(meshConfig.geometry),
                                       maybeCreateMaterial(meshConfig.material)))
    default:
      throw new Error("Unknown Object3D type: " + objectConfig.type)
  }
}

const gltfs :Map<string, Subject<Object3D>> = new Map()
const errorGeom = new BoxBufferGeometry()
const errorMat = new MeshBasicMaterial({color: 0xFF0000})

function loadGLTF (url :string) {
  let gltf = gltfs.get(url)
  if (!gltf) {
    gltfs.set(url, gltf = Subject.deriveSubject(dispatch => {
      new GLTFLoader().load(
        url,
        gltf => {
          // hack for alpha testing: enable on any materials with a color texture that has
          // an alpha channel
          gltf.scene.traverse((node :Object3D) => {
            if (node instanceof Mesh) {
              const material = node.material
              if (material instanceof MeshStandardMaterial &&
                  material.map &&
                  material.map.format === RGBAFormat) {
                material.alphaTest = 0.9
                material.transparent = false
              }
            }
          })
          dispatch(gltf.scene)
        },
        event => { /* do nothing with progress for now */ },
        error => {
          console.error(error)
          dispatch(new Mesh(errorGeom, errorMat))
        },
      )
      return NoopRemover
    }))
  }
  return gltf
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
