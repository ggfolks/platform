import {
  AmbientLight, AnimationClip, AnimationMixer, BoxBufferGeometry, Camera, Color, DirectionalLight,
  HemisphereLight, Intersection, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  MeshToonMaterial, Object3D, ObjectLoader, PerspectiveCamera, Plane, PlaneBufferGeometry,
  RGBAFormat, Raycaster, Scene, SphereBufferGeometry, Vector2, Vector3, WebGLRenderer,
} from "three"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader"
import {SkeletonUtils} from "three/examples/jsm/utils/SkeletonUtils"

import {Clock} from "../core/clock"
import {Subject} from "../core/react"
import {RMap} from "../core/rcollect"
import {Noop, NoopRemover, Remover, log} from "../core/util"
import {Pointer} from "../input/hand"
import {
  Component,
  Domain,
  EntityConfig,
  ID,
  Matcher,
  System,
} from "../entity/entity"
import {TransformComponent} from "../space/entity"

/** Base class for 3D object configs. */
export interface Object3DConfig {
  type :string
  /** An optional callback may be used to modify or replace the loaded resource. */
  onLoad? :(obj :Object3D) => Object3D|undefined
}

/** Configures an object loaded from a GLTF resource. */
export interface GLTFConfig extends Object3DConfig {
  type :"gltf"
  url :string
}

/** Configures an object loaded from a Json resource. */
export interface JsonConfig extends Object3DConfig {
  type :"json"
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

/** Configures a hemisphere light. */
export interface HemisphereLightConfig extends LightConfig {
  type: "hemisphereLight"
  groundColor? :number
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

/** Configuration for plane buffer geometry. */
export interface PlaneBufferConfig extends GeometryConfig {
  type :"planeBuffer"
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
let hovered :Map<ID, HoverMap> = new Map()
let lastHovered :Map<ID, HoverMap> = new Map()
const direction = new Vector3()
const point = new Vector3()
const plane = new Plane()
const worldMovement = new Vector3()
const viewPosition = new Vector3()
const viewMovement = new Vector3()

/** The canonical id of the object component. */
export const CanonicalObjectId = "obj"

/** The canonical id of the hovers component. */
export const CanonicalHoversId = "hovers"

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
               readonly hovers? :Component<HoverMap>,
               readonly pointers? :RMap<number, Pointer>) {
    super(domain, Matcher.hasAllC(trans.id, obj.id))
    this.scene.autoUpdate = false
  }

  /** Updates the hover states.  Because this can trigger graph updates (and animation updates,
    * transforms, etc.), it should be called before the graph update but after the hand update. */
  updateHovers (renderer :WebGLRenderer) {
    if (!(this.hovers && this.pointers)) return
    renderer.getSize(rendererSize)
    hovered.clear()
    for (const [identifier, pointer] of this.pointers) {
      for (const camera of this._cameras) {
        // make sure forward/inverse world matrices are up-to-date
        camera.updateMatrixWorld()

        raycaster.setFromCamera(
          pointerCoords.set(
            pointer.position[0] / rendererSize.x * 2 - 1,
            1 - pointer.position[1] / rendererSize.y * 2,
          ),
          camera,
        )

        // pressed objects stay hovered until the press ends
        const pressedObject = this._pressedObjects.get(identifier)
        if (pressedObject) {
          if (pointer.pressed) {
            if (!pressedObject.parent) {
              continue // hold off updating until pointer released
            }
            // constrain motion to a plane aligned with the camera direction
            const hoverMap = this.hovers.read(pressedObject.userData.id)
            const hover = hoverMap && hoverMap.get(identifier)
            if (hover) {
              plane.setFromNormalAndCoplanarPoint(
                camera.getWorldDirection(direction),
                point.copy(hover.viewPosition).applyMatrix4(camera.matrixWorld),
              )
              this._maybeNoteHovered(
                identifier,
                pointer,
                camera,
                pressedObject,
                raycaster.ray.intersectPlane(plane, point) || point.copy(hover.worldPosition),
              )
              continue
            }
          } else {
            this._pressedObjects.delete(identifier)
          }
        }
        intersections.length = 0
        let noted = false
        for (const intersection of raycaster.intersectObject(this.scene, true, intersections)) {
          let ancestor :Object3D | null = intersection.object
          while (ancestor && ancestor.userData.id === undefined) {
            ancestor = ancestor.parent
          }
          if (
            ancestor &&
            this._maybeNoteHovered(identifier, pointer, camera, ancestor, intersection.point)
          ) {
            noted = true
            break
          }
        }
        // if we didn't hit anything else, "hover" on the camera
        if (!noted) {
          // use intersection with a plane one unit in front of the camera
          const dp = camera.getWorldDirection(direction).dot(raycaster.ray.direction)
          this._maybeNoteHovered(
            identifier,
            pointer,
            camera,
            camera,
            raycaster.ray.at(1 / dp, point),
          )
        }
      }
    }
    // remove any pressed objects whose pointers are no longer in the map
    for (const identifier of this._pressedObjects.keys()) {
      if (!this.pointers.has(identifier)) this._pressedObjects.delete(identifier)
    }
    // clear the components of any entities not in the current map
    for (const id of lastHovered.keys()) {
      if (!hovered.has(id)) this.hovers.update(id, new Map())
    }
    // update the components of any entities in the current map
    for (const [id, map] of hovered) {
      this.hovers.update(id, map)
    }
    // swap for next time
    [lastHovered, hovered] = [hovered, lastHovered]
  }

  /** Updates the scene. */
  update () {
    this.onEntities(id => this._updateObject(id, this.obj.read(id)))
    this.scene.updateMatrixWorld()
  }

  /** Renders the scene. */
  render (renderer :WebGLRenderer) {
    renderer.getSize(rendererSize)
    const aspect = rendererSize.x / rendererSize.y
    for (const camera of this._cameras) {
      if (camera instanceof PerspectiveCamera && camera.aspect !== aspect) {
        camera.aspect = aspect
        camera.updateProjectionMatrix()
      }
      renderer.render(this.scene, camera)
    }
  }

  _maybeNoteHovered (
    identifier :number,
    pointer :Pointer,
    camera :Camera,
    object :Object3D,
    worldPosition :Vector3,
  ) {
    const id = object.userData.id
    const comps = this.domain.entityConfig(id).components
    const hovers = this.hovers as Component<HoverMap>
    if (!comps[hovers.id]) {
      return false
    }
    let map = hovered.get(id)
    if (!map) {
      hovered.set(id, map = new Map())
    }
    let omap = hovers.read(id)
    const ohover = omap && omap.get(identifier)
    if (ohover) {
      worldMovement.subVectors(worldPosition, ohover.worldPosition)
      viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse)
      viewMovement.subVectors(viewPosition, ohover.viewPosition)
      if (
        worldPosition.equals(ohover.worldPosition) &&
        worldMovement.equals(ohover.worldMovement) &&
        viewPosition.equals(ohover.viewPosition) &&
        viewMovement.equals(ohover.viewMovement) &&
        pointer.pressed === ohover.pressed
      ) {
        map.set(identifier, ohover)
      } else {
        map.set(identifier, new Hover(
          worldPosition.clone(),
          worldMovement.clone(),
          viewPosition.clone(),
          viewMovement.clone(),
          pointer.pressed,
        ))
      }
    } else {
      map.set(identifier, new Hover(
        worldPosition.clone(),
        new Vector3(),
        worldPosition.clone().applyMatrix4(camera.matrixWorldInverse),
        new Vector3(),
        pointer.pressed,
      ))
    }
    if (pointer.pressed) this._pressedObjects.set(identifier, object)
    return true
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    // start with an empty object
    const cfg = config.components[this.obj.id]
    const obj = new Object3D()
    obj.userData.id = id
    this.obj.update(id, obj)
    this.scene.add(obj)
    this._updateObject(id, obj)
    obj.updateMatrixWorld()
    createObject3D(cfg).onValue(obj => {
      if (cfg.onLoad) obj = cfg.onLoad(obj) || obj
      // if this is the initial, default Object3D, it won't actually be in the scene;
      // otherwise, we're replacing the model with another
      const oldObj = this.obj.read(id)
      this.scene.remove(oldObj)
      if (oldObj instanceof Camera) this._cameras.delete(oldObj)
      obj.userData.id = id
      this.obj.update(id, obj)
      this.scene.add(obj)
      if (obj instanceof Camera) this._cameras.add(obj)
      if (cfg.type === "json") {
        // init the trans component with the loaded values
        this.trans.updatePosition(id, obj.position)
        this.trans.updateQuaternion(id, obj.quaternion)
        this.trans.updateScale(id, obj.scale)
      } else {
        this._updateObject(id, obj)
      }
      obj.updateMatrixWorld()
    })
  }

  private _updateObject (id :ID, obj :Object3D) {
    this.trans.readPosition(id, obj.position)
    this.trans.readQuaternion(id, obj.quaternion)
    this.trans.readScale(id, obj.scale)
  }

  protected deleted (id :ID) {
    const obj = this.obj.read(id)
    this.scene.remove(obj)
    if (obj instanceof Camera) this._cameras.delete(obj)
    super.deleted(id)
  }
}

/** Describes a hover point. */
export class Hover {
  constructor (readonly worldPosition :Vector3,
               readonly worldMovement :Vector3,
               readonly viewPosition :Vector3,
               readonly viewMovement :Vector3,
               readonly pressed :boolean) {}
}

/** Maps hover identifiers to hover objects. */
export type HoverMap = Map<number, Hover>

/** The canonical id of the animation mixer component. */
export const CanonicalMixerId = "mixer"

/** Manages AnimationMixer instances for animated objects. */
export class AnimationSystem extends System {

  _removers :Map<ID, Remover> = new Map()

  constructor (domain :Domain,
               readonly obj :Component<Object3D>,
               readonly mixer :Component<AnimationMixer>) {
    super(domain, Matcher.hasAllC(obj.id, mixer.id))
  }

  update (clock :Clock) {
    this.onEntities(id => this.mixer.read(id).update(clock.dt))
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    this._removers.set(id, this.obj.getValue(id).onValue(obj => {
      this.mixer.update(id, new AnimationMixer(obj))
    }))
  }

  protected deleted (id :ID) {
    super.deleted(id)
    const remover = this._removers.get(id)
    if (remover) {
      this._removers.delete(id)
      remover()
    }
  }
}

const errorAnimation = new AnimationClip("error", 0, [])

/**
 * Loads a GLTF animation clip identified by an anchored URL, where the anchor tag is taken to
 * represent the clip name.
 */
export function loadGLTFAnimationClip (url :string) :Subject<AnimationClip> {
  const idx = url.indexOf('#')
  return loadGLTF(url.substring(0, idx)).map(gltf => {
    const clip = AnimationClip.findByName(gltf.animations, url.substring(idx + 1))
    if (clip) return clip
    log.warn("Missing requested animation", "url", url)
    return errorAnimation
  })
}

export function createObject3D (objectConfig: Object3DConfig) :Subject<Object3D> {
  switch (objectConfig.type) {
    case "gltf":
      const gltfConfig = objectConfig as GLTFConfig
      return loadGLTF(gltfConfig.url).map(gltf => SkeletonUtils.clone(gltf.scene) as Object3D)

    case "json":
      const jsonConfig = objectConfig as JsonConfig
      return Subject.deriveSubject(dispatch => {
        new ObjectLoader().load(jsonConfig.url, dispatch /*onLoad*/, Noop /* onProgress */,
          error => { // onError
            console.error(error)
            const errObj = new Object3D()
            errObj.name =  "ERROR: " + error
            dispatch(errObj)
          })
        return NoopRemover
      })

    case "perspectiveCamera":
      return Subject.constant(new PerspectiveCamera())

    case "directionalLight":
      const dlConfig = objectConfig as DirectionalLightConfig
      return Subject.constant(new DirectionalLight(dlConfig.color, dlConfig.intensity))

    case "hemisphereLight":
      const hlConfig = objectConfig as HemisphereLightConfig
      return Subject.constant(
          new HemisphereLight(hlConfig.color, hlConfig.groundColor, hlConfig.intensity))

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

interface GLTF {
  scene :Object3D
  animations :AnimationClip[]
}

const activeGLTFs :Map<string, Subject<GLTF>> = new Map()
const dormantGLTFs :Map<string, Promise<GLTF>> = new Map()
const errorGeom = new BoxBufferGeometry()
const errorMat = new MeshBasicMaterial({color: 0xFF0000})

export function loadGLTF (url :string) :Subject<GLTF> {
  let gltf = activeGLTFs.get(url)
  if (!gltf) {
    let active = false
    gltf = Subject.deriveSubject(dispatch => {
      active = true
      activeGLTFs.set(url, gltf!)
      let savedGLTF = dormantGLTFs.get(url)
      if (savedGLTF) {
        dormantGLTFs.delete(url)
      } else {
        savedGLTF = new Promise(resolve => new GLTFLoader().load(
          url,
          gltf => {
            // hack for alpha testing: enable on any materials with a color texture that has
            // an alpha channel
            gltf.scene.traverse((node :Object3D) => {
              if (node instanceof Mesh) processMaterial(node.material)
            })
            resolve(gltf)
          },
          event => { /* do nothing with progress for now */ },
          error => {
            log.warn("Could not load GLTF", "url", url, "error", error)
            resolve({scene: new Mesh(errorGeom, errorMat), animations: []})
          },
        ))
      }
      savedGLTF.then(gltf => {
        if (active) dispatch(gltf)
      })
      return () => {
        active = false
        activeGLTFs.delete(url)
        dormantGLTFs.set(url, savedGLTF!)
      }
    })
  }
  return gltf
}

function processMaterial (material :Material|Material[]) {
  if (Array.isArray(material)) material.forEach(processMaterial)
  else {
    if (material instanceof MeshStandardMaterial &&
        material.map &&
        material.map.format === RGBAFormat) {
      material.alphaTest = 0.9
      material.transparent = false
    }
    // note that this material may be shared by multiple instances
    material.userData.shared = true
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
    case "planeBuffer":
      return new PlaneBufferGeometry()
    default:
      throw new Error("Unknown geometry type: " + geometryConfig.type)
  }
}
