import {
  AnimationClip, AnimationMixer, AmbientLight, BackSide, Box3, BoxBufferGeometry, BufferAttribute,
  BufferGeometry, ConeBufferGeometry, CylinderBufferGeometry, DefaultLoadingManager,
  DirectionalLight, DoubleSide, FrontSide, Group, Intersection, Light as LightObject,
  LoopOnce, LoopRepeat, LoopPingPong, Material as MaterialObject, Matrix3, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera,
  PlaneBufferGeometry, Quaternion, Ray as RayObject, Raycaster, Scene, ShaderMaterial, Sphere,
  SphereBufferGeometry, Texture, TorusBufferGeometry, Vector2, Vector3, WebGLRenderer,
} from "three"
import {SkeletonUtils} from "three/examples/jsm/utils/SkeletonUtils"
import {Clock} from "../../../core/clock"
import {Color} from "../../../core/color"
import {refEquals} from "../../../core/data"
import {Bounds, Plane, Ray, dim2, rect, vec2, vec2zero, vec3} from "../../../core/math"
import {Mutable, Subject, Value} from "../../../core/react"
import {MutableMap, RMap} from "../../../core/rcollect"
import {Disposer, Noop, NoopRemover, Remover, getValue} from "../../../core/util"
import {ResourceLoader} from "../../../asset/loader"
import {Graph, GraphConfig} from "../../../graph/graph"
import {PropertyMeta, setEnumMeta} from "../../../graph/meta"
import {GLTF, loadGLTF, loadGLTFAnimationClip} from "../../../scene3/entity"
import {Hand, Pointer} from "../../../input/hand"
import {wheelEvents} from "../../../input/react"
import {
  ALL_LAYERS_MASK, DEFAULT_PAGE, ConfigurableConfig, GameObjectConfig, Hover, Transform,
} from "../../game"
import {Animation, WrapMode, WrapModes} from "../../animation"
import {getConfigurableMeta, property} from "../../meta"
import {
  Bounded, Camera, FusedModels, Light, LightType, LightTypes, Material, MaterialSide, MaterialSides,
  MeshRenderer, Model, RaycastHit, RenderEngine,
} from "../../render"
import {decodeFused} from "../../util"
import {
  TypeScriptComponent, TypeScriptCone, TypeScriptConfigurable, TypeScriptCube, TypeScriptCylinder,
  TypeScriptGameEngine, TypeScriptGameObject, TypeScriptMesh, TypeScriptMeshFilter, TypeScriptPage,
  TypeScriptQuad, TypeScriptSphere, TypeScriptTorus, applyConfig, registerConfigurableType,
} from "../game"

setEnumMeta("LightType", LightTypes)

const defaultCamera = new PerspectiveCamera()
const raycaster :Raycaster = new Raycaster()
const raycasterResults :Intersection[] = []
const raycastHits :RaycastHit[] = []

const coords = vec2.create()
const tmpr = Ray.create()
const tmpv = vec3.create()
const tmpp = vec3.create()
const tmpPlane = Plane.create()
const tmpBoundingBox = new Box3()
const nodeBoundingBox = new Box3()
const worldMovement = vec3.create()
const viewPosition = vec3.create()
const viewMovement = vec3.create()

type HoverMap = Map<number, Hover>
let hovered :Map<ThreeObjectComponent, HoverMap> = new Map()
let lastHovered :Map<ThreeObjectComponent, HoverMap> = new Map()

/** A render engine that uses Three.js. */
export class ThreeRenderEngine implements RenderEngine {
  private readonly _disposer = new Disposer()
  private readonly _hand :Hand
  private readonly _pressedObjects = new Map<number, ThreeObjectComponent>()
  private readonly _bounds = rect.create()
  private readonly _size = Mutable.local(dim2.create())
  private readonly _percentLoaded = Mutable.local(1)
  private _frameCount = 0

  readonly renderer = new WebGLRenderer()
  readonly domElement = this.renderer.domElement
  readonly stats :Value<string[]>
  readonly scene = new Scene()
  readonly cameras :ThreeCamera[] = []

  mergedStatic? :ThreeMergedStatic

  onAfterRender? :(scene :Scene, camera :CameraObject) => void

  get size () :Value<dim2> { return this._size }

  get activeCameras () :ThreeCamera[] {
    const activePage = this._activePage
    return activePage ? activePage.cameras : this.cameras
  }

  get percentLoaded () :Value<number> { return this._percentLoaded }

  constructor (readonly gameEngine :TypeScriptGameEngine) {
    gameEngine._renderEngine = this

    this._disposer.add(this.renderer)
    this._disposer.add(this.scene)

    // settings recommended for GLTF loader:
    // https://threejs.org/docs/index.html#examples/en/loaders/GLTFLoader
    this.renderer.gammaOutput = true
    this.renderer.gammaFactor = 2.2

    this.renderer.autoClear = false

    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"

    this.renderer.info.autoReset = false

    let currentStats :string[] = []
    this.stats = Value.deriveValue(
      refEquals,
      dispatch => {
        this._frameCount = 0
        const interval = setInterval(() => {
          const oldStats = currentStats
          const info = this.renderer.info
          dispatch(currentStats = [
            `${this._frameCount} fps`,
            `${info.memory.geometries} geometries, ${info.memory.textures} textures`,
            `${info.render.calls} calls, ${info.render.triangles} triangles`,
            `${info.programs ? info.programs.length : 0} programs`
          ], oldStats)
          this._frameCount = 0
        }, 1000)
        return () => clearInterval(interval)
      },
      () => currentStats,
    )

    DefaultLoadingManager.onStart = DefaultLoadingManager.onProgress =
      (url, itemsLoaded, itemsTotal) => this._percentLoaded.update(itemsLoaded / itemsTotal)
    DefaultLoadingManager.onLoad = () => this._percentLoaded.update(1)

    gameEngine.root.appendChild(this.renderer.domElement)
    this._disposer.add(() => gameEngine.root.removeChild(this.renderer.domElement))
    this._disposer.add(gameEngine.ctx.screen.onValue(b => this.setBounds(b)))

    this._disposer.add(gameEngine.ctx.hand = this._hand = new Hand(this.renderer.domElement))

    const delta = vec3.create()
    this._disposer.add(wheelEvents.onEmit(event => {
      vec3.set(delta, event.deltaX, event.deltaY, event.deltaZ)
      for (const [objectComponent, hovers] of lastHovered) {
        for (const [identifier, hover] of hovers) {
          objectComponent.sendMessage("onWheel", identifier, hover, delta)
        }
      }
    }))

    this.scene.autoUpdate = false
  }

  preload (url :string) :void {
    loadGLTF(this.gameEngine.loader, url).once(Noop) // subscribe to trigger loading
  }

  noteLoading (url :string) :void {
    DefaultLoadingManager.itemStart(url)
  }

  noteFinished (url :string) :void {
    DefaultLoadingManager.itemEnd(url)
  }

  startMerging (config? :GameObjectConfig) :void {
    const mergedConfig = {
      mergedStatic: {},
    }
    if (config) applyConfig(mergedConfig, config)
    const gameObject = this.gameEngine.createGameObject("merged", mergedConfig)
    this.mergedStatic = gameObject.requireComponent<ThreeMergedStatic>("mergedStatic")
  }

  stopMerging () :void {
    if (this.mergedStatic) {
      this.mergedStatic.build()
      this.mergedStatic = undefined
    }
  }

  setBounds (bounds :rect) :void {
    if (rect.eq(bounds, this._bounds)) return
    rect.copy(this._bounds, bounds)
    const style = this.renderer.domElement.style
    style.position = "absolute"
    style.left = `${bounds[0]}px`
    style.top = `${bounds[1]}px`
    style.width = `${bounds[2]}px`
    style.height = `${bounds[3]}px`
    this._updateRendererSize()
  }

  private _updateRendererSize () {
    const size = dim2.fromValues(
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    )
    this.renderer.setSize(size[0], size[1], false)
    this._size.update(size)
  }

  raycastAll (
    origin :vec3,
    direction :vec3,
    minDistance :number = 0,
    maxDistance :number = Infinity,
    layerMask :number = ALL_LAYERS_MASK,
    target? :RaycastHit[],
  ) :RaycastHit[] {
    raycaster.near = minDistance
    raycaster.far = maxDistance
    raycaster.ray.origin.fromArray(origin)
    raycaster.ray.direction.fromArray(direction)
    raycasterResults.length = 0

    raycasterIntersectObject(this._activeScene, layerMask)
    raycasterResults.sort(compareRaycasterResults)

    if (target) target.length = 0
    else target = []
    for (const result of raycasterResults) {
      target.push({
        distance: result.distance,
        point: result.point.toArray(vec3.create()) as vec3,
        transform: getTransform(result.object),
        textureCoord: result.uv ? result.uv.toArray(vec2.create()) as vec2 : undefined,
        triangleIndex: result.faceIndex,
      })
    }
    return target
  }

  overlapBounds (bounds :Bounds, layerMask = ALL_LAYERS_MASK, target? :Transform[]) :Transform[] {
    if (target) target.length = 0
    else target = []
    const constTarget = target
    tmpBoundingBox.min.fromArray(bounds.min)
    tmpBoundingBox.max.fromArray(bounds.max)
    this._activeScene.traverse(node => {
      if (!node.userData.boundingBox) return
      nodeBoundingBox.copy(node.userData.boundingBox).applyMatrix4(node.matrixWorld)
      if (tmpBoundingBox.intersectsBox(nodeBoundingBox)) {
        const transform = getTransform(node)
        if (transform.gameObject.layerFlags & layerMask) constTarget.push(transform)
      }
    })
    return target
  }

  updateHovers () {
    this._hand.update()
    hovered.clear()
    for (const camera of this.activeCameras) {
      for (const [identifier, pointer] of this._hand.pointers) {
        camera.screenPointToRay(vec2.set(coords, pointer.position[0], pointer.position[1]), tmpr)

        // pressed objects stay hovered until the press ends
        const pressedObject = this._pressedObjects.get(identifier)
        if (pressedObject) {
          if (pointer.pressed) {
            // constrain motion to a plane aligned with the camera direction
            const hover = pressedObject.hovers.get(identifier)
            if (hover) {
              Plane.setFromNormalAndCoplanarPoint(
                tmpPlane,
                camera.getDirection(tmpv),
                vec3.transformMat4(tmpp, hover.viewPosition, camera.transform.localToWorldMatrix),
              )
              const distance = Plane.intersectRay(tmpPlane, tmpr.origin, tmpr.direction)
              if (distance >= 0) Ray.getPoint(tmpp, tmpr, distance)
              else vec3.copy(tmpp, hover.worldPosition)
              this._maybeNoteHovered(identifier, pointer, camera, pressedObject, tmpp)
              continue
            }
          } else {
            this._pressedObjects.delete(identifier)
          }
        }

        this.raycastAll(tmpr.origin, tmpr.direction, 0, Infinity, camera.eventMask, raycastHits)
        let noted = false
        for (const hit of raycastHits) {
          const objectComponent = hit.transform.getComponent<ThreeObjectComponent>("hoverable")
          if (
            objectComponent &&
            this._maybeNoteHovered(identifier, pointer, camera, objectComponent, hit.point)
          ) {
            noted = true
            break
          }
        }
        // if we didn't hit anything else, "hover" on the camera
        if (!noted && (camera.gameObject.layerFlags & camera.eventMask)) {
          // use intersection with a plane one unit in front of the camera
          const distance = camera.orthographic
            ? 1
            : 1 / vec3.dot(camera.getDirection(tmpv), tmpr.direction)
          this._maybeNoteHovered(
            identifier,
            pointer,
            camera,
            camera,
            Ray.getPoint(tmpp, tmpr, distance),
          )
        }
      }
    }
    // remove any pressed objects whose pointers are no longer in the map
    for (const identifier of this._pressedObjects.keys()) {
      if (!this._hand.pointers.has(identifier)) this._pressedObjects.delete(identifier)
    }
    // clear the components of any entities not in the current map
    for (const objectComponent of lastHovered.keys()) {
      if (!hovered.has(objectComponent)) objectComponent._setHovers(new Map())
    }
    // update the components of any entities in the current map
    for (const [objectComponent, map] of hovered) {
      objectComponent._setHovers(map)
    }
    // swap for next time
    [lastHovered, hovered] = [hovered, lastHovered]
  }

  private _maybeNoteHovered (
    identifier :number,
    pointer :Pointer,
    camera :ThreeCamera,
    objectComponent :ThreeObjectComponent,
    worldPosition :vec3,
  ) :boolean {
    let map = hovered.get(objectComponent)
    if (!map) hovered.set(objectComponent, map = new Map())
    const ohover = objectComponent.hovers.get(identifier)
    if (ohover) {
      vec3.subtract(worldMovement, worldPosition, ohover.worldPosition)
      vec3.transformMat4(viewPosition, worldPosition, camera.transform.worldToLocalMatrix)
      vec3.subtract(viewMovement, viewPosition, ohover.viewPosition)
      if (
        vec3.equals(worldPosition, ohover.worldPosition) &&
        vec3.equals(worldMovement, ohover.worldMovement) &&
        vec3.equals(viewPosition, ohover.viewPosition) &&
        vec3.equals(viewMovement, ohover.viewMovement) &&
        pointer.pressed === ohover.pressed
      ) {
        map.set(identifier, ohover)
      } else {
        map.set(identifier, {
          worldPosition: vec3.clone(worldPosition),
          worldMovement: vec3.clone(worldMovement),
          viewPosition: vec3.clone(viewPosition),
          viewMovement: vec3.clone(viewMovement),
          pressed: pointer.pressed,
        })
      }
    } else {
      map.set(identifier, {
        worldPosition: vec3.clone(worldPosition),
        worldMovement: vec3.create(),
        viewPosition: vec3.transformMat4(
          vec3.create(),
          worldPosition,
          camera.transform.worldToLocalMatrix,
        ),
        viewMovement: vec3.create(),
        pressed: pointer.pressed,
      })
    }
    if (pointer.pressed) this._pressedObjects.set(identifier, objectComponent)
    return true
  }

  render () {
    this._frameCount++
    const activePage = this._activePage
    let cameras :ThreeCamera[]
    let scene :Scene
    if (activePage) {
      cameras = activePage.cameras
      scene = activePage.scene
    } else {
      cameras = this.cameras
      scene = this.scene
    }
    const camera = cameras.length > 0 ? cameras[0].cameraObject : defaultCamera
    this.renderer.info.reset()
    this.renderer.clear()
    this.renderer.render(scene, camera)
    if (this.onAfterRender) this.onAfterRender(scene, camera)
  }

  protected get _activeScene () :Scene {
    const activePage = this._activePage
    return activePage ? activePage.scene : this.scene
  }

  protected get _activePage () :ThreePage|undefined {
    const activePage = this.gameEngine.activePage.current
    return (activePage === DEFAULT_PAGE)
      ? undefined
      : this.gameEngine.gameObjects.require(activePage).requireComponent<ThreePage>("page")
  }

  dispose () {
    this._disposer.dispose()
  }
}

function raycasterIntersectObject (object :Object3D, layerMask :number) {
  const transform = object.userData.transform
  if (transform && !(transform.gameObject.layerFlags & layerMask)) return
  object.raycast(raycaster, raycasterResults)
  for (const child of object.children) raycasterIntersectObject(child, layerMask)
}

function compareRaycasterResults (a :Intersection, b :Intersection) {
  return a.distance - b.distance
}

function getTransform (object :Object3D) :Transform {
  if (object.userData.transform) return object.userData.transform
  if (!object.parent) throw new Error("Can't find transform corresponding to Object3D")
  return getTransform(object.parent)
}

class ThreePage extends TypeScriptPage {
  readonly scene = new Scene()
  readonly cameras :ThreeCamera[] = []

  init () {
    super.init()
    this.scene.autoUpdate = false
  }
}
registerConfigurableType("component", undefined, "page", ThreePage)

setEnumMeta("MaterialSide", MaterialSides)

abstract class ThreeMaterial extends TypeScriptConfigurable implements Material {
  @property("boolean") transparent = false
  @property("number", {min: 0, max: 1, wheelStep: 0.1}) alphaTest = 0
  @property("MaterialSide") side :MaterialSide = "front"
  @property("number", {min: 0, max: 1, wheelStep: 0.1}) opacity = 1

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
    readonly object :MaterialObject,
  ) {
    super(gameEngine, supertype, type)
    this._disposer.add(object)
  }

  init () {
    super.init()
    for (const property of ["transparent", "alphaTest", "opacity"]) {
      this.getProperty<any>(property).onValue(value => {
        this.object[property] = value
        this.object.needsUpdate = true
      })
    }
    this.getProperty<MaterialSide>("side").onValue(side => {
      this.object.side = (side === "front")
        ? FrontSide
        : side === "back"
        ? BackSide
        : DoubleSide
      this.object.needsUpdate = true
    })
  }
}

type BasicStandardMaterial = MeshBasicMaterial | MeshStandardMaterial

class ThreeBasicMaterial extends ThreeMaterial {
  private readonly _color :Color

  get color () :Color { return this._color }
  set color (color :Color) { Color.copy(this._color, color) }

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
    readonly object :BasicStandardMaterial = new MeshBasicMaterial(),
  ) {
    super(gameEngine, supertype, type, object)
    this._color = new Proxy(Color.fromRGB(1, 1, 1), {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._updateColor()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })
  }

  private _updateColor () {
    this.object.color.fromArray(this._color, 1)
    this.object.opacity = this._color[0]
  }
}
registerConfigurableType("material", [], "basic", ThreeBasicMaterial)

class ThreeStandardMaterial extends ThreeBasicMaterial {

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
  ) {
    super(gameEngine, supertype, type, new MeshStandardMaterial())
  }
}
registerConfigurableType("material", [], "standard", ThreeStandardMaterial)

class ThreeShaderMaterial extends ThreeMaterial {
  private readonly _vertexShaderGraph :Graph
  private readonly _fragmentShaderGraph :Graph

  @property("GraphConfig", {editable: false}) get vertexShaderGraphConfig () :GraphConfig {
    return this._vertexShaderGraph.config
  }
  set vertexShaderGraphConfig (config :GraphConfig) {
    this._vertexShaderGraph.reconfigure(config)
    this.object.vertexShader = this._vertexShaderGraph.createVertexShader()
  }

  @property("GraphConfig", {editable: false}) get fragmentShaderGraphConfig () :GraphConfig {
    return this._fragmentShaderGraph.config
  }
  set fragmentShaderGraphConfig (config :GraphConfig) {
    this._fragmentShaderGraph.reconfigure(config)
    this.object.fragmentShader = this._fragmentShaderGraph.createFragmentShader()
  }

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
    readonly object = new ShaderMaterial(),
  ) {
    super(gameEngine, supertype, type, object)
    this._vertexShaderGraph = new Graph(gameEngine.ctx, {})
    this._fragmentShaderGraph = new Graph(gameEngine.ctx, {})
  }
}
registerConfigurableType("material", [], "shader", ThreeShaderMaterial)

export abstract class ThreeObjectComponent extends TypeScriptComponent {
  readonly objectValue = Mutable.local<Object3D|undefined>(undefined)
  readonly hovers = MutableMap.local<number, Hover>()

  protected _page? :ThreePage

  get renderEngine () :ThreeRenderEngine {
    return this.gameObject.gameEngine.renderEngine as ThreeRenderEngine
  }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject, "hoverable")
    this._disposer.add(this.objectValue.onValue((
      object,
      oldObject? :Object3D,
    ) => {
      if (oldObject) this._removeFromPage(this._page, oldObject)
      if (object) {
        object.matrixAutoUpdate = false
        this._updateObjectTransform(object)
        this._updateObjectLayers(object)
        object.userData.transform = this.transform
        this._addToPage(this._page, object)
      }
    }))
    this._disposer.add(gameObject.getProperty<number>("layerFlags").onChange(flags => {
      const object = this.objectValue.current
      if (object) this._updateObjectLayers(object)
    }))
  }

  awake () {
    this._updatePage()
  }

  onTransformChanged () {
    const object = this.objectValue.current
    if (object) this._updateObjectTransform(object)
  }

  onTransformParentChanged () {
    this._updatePage()
  }

  protected _updatePage () {
    const page = this.getComponentInParent<ThreePage>("page")
    if (this._page === page) return
    this._removeFromPage(this._page, this.objectValue.current)
    this._addToPage(this._page = page, this.objectValue.current)
  }

  protected _removeFromPage (page :ThreePage|undefined, object :Object3D|undefined) {
    if (!object) return
    if (page) page.scene.remove(object)
    else this.renderEngine.scene.remove(object)
  }

  protected _addToPage (page :ThreePage|undefined, object :Object3D|undefined) {
    if (!object) return
    if (page) page.scene.add(object)
    else this.renderEngine.scene.add(object)
  }

  dispose () {
    this.objectValue.update(undefined)
    super.dispose()
  }

  _setHovers (map :HoverMap) {
    // remove anything no longer in the map
    for (const [identifier, hover] of this.hovers) {
      if (!map.has(identifier)) {
        this.hovers.delete(identifier)
        if (hover.pressed) this.sendMessage("onPointerUp", identifier)
        this.sendMessage("onPointerExit", identifier)
      }
    }
    // add/update everything in the map
    for (const [identifier, hover] of map) {
      const oldHover = this.hovers.get(identifier)
      this.hovers.set(identifier, hover)

      if (!oldHover) this.sendMessage("onPointerEnter", identifier, hover)
      if (hover.pressed) {
        if (!(oldHover && oldHover.pressed)) this.sendMessage("onPointerDown", identifier, hover)
        this.sendMessage("onPointerDrag", identifier, hover)
      } else if (oldHover && oldHover.pressed) {
        this.sendMessage("onPointerUp", identifier, hover)
      }
      this.sendMessage("onPointerOver", identifier, hover)
    }
  }

  protected _updateObjectTransform (object :Object3D) {
    object.matrixWorld.fromArray(this.transform.localToWorldMatrix)
  }

  protected _updateObjectLayers (object :Object3D) {
    object.traverse(node => node.layers.mask = this.gameObject.layerFlags)
  }
}

class ThreeBounded extends ThreeObjectComponent implements Bounded {
  readonly bounds :Bounds

  private readonly _boundsTarget = Bounds.create()
  protected _boundsValid = true

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    const createReadOnlyProxy = (value :vec3) => new Proxy(value, {
      set: (obj, prop, value) => {
        throw new Error("Object is read-only")
      },
      get: (obj, prop) => {
        this._validateBounds()
        return obj[prop]
      },
    })
    this.bounds = Bounds.create(
      createReadOnlyProxy(this._boundsTarget.min),
      createReadOnlyProxy(this._boundsTarget.max),
    )
  }

  protected _updateObjectTransform (object :Object3D) {
    super._updateObjectTransform(object)
    this._boundsValid = false
  }

  protected _validateBounds () {
    if (this._boundsValid) return
    this._boundsValid = true
    const object = this.objectValue.current
    if (!object) {
      Bounds.zero(this._boundsTarget)
      return
    }
    tmpBoundingBox.copy(object.userData.boundingBox).applyMatrix4(object.matrixWorld)
    tmpBoundingBox.min.toArray(this._boundsTarget.min)
    tmpBoundingBox.max.toArray(this._boundsTarget.max)
  }
}

const TypeScriptCubePrototype = TypeScriptCube.prototype as any
TypeScriptCubePrototype._bufferGeometry = new BoxBufferGeometry()

const TypeScriptCylinderPrototype = TypeScriptCylinder.prototype as any
TypeScriptCylinderPrototype._bufferGeometry = new CylinderBufferGeometry()

const TypeScriptQuadPrototype = TypeScriptQuad.prototype as any
TypeScriptQuadPrototype._bufferGeometry = new PlaneBufferGeometry()

const TypeScriptSpherePrototype = TypeScriptSphere.prototype as any
TypeScriptSpherePrototype._bufferGeometry = new SphereBufferGeometry(1, 16, 12)

const TypeScriptConePrototype = TypeScriptCone.prototype as any
TypeScriptConePrototype._bufferGeometry = new ConeBufferGeometry(1, 1, 16)

const TypeScriptTorusPrototype = TypeScriptTorus.prototype as any
TypeScriptTorusPrototype._bufferGeometry = new TorusBufferGeometry(1, 0.4, 16, 12)

const emptyGeometry = new BufferGeometry()

class ThreeMeshRenderer extends ThreeBounded implements MeshRenderer {
  private _mesh = new Mesh()
  private _materials :ThreeMaterial[]

  get material () :Material { return this.materials[0] }
  set material (mat :Material) { this.materials = [mat] }

  get materials () :Material[] { return this._materials }
  set materials (mats :Material[]) {
    let ii = 0
    for (; ii < mats.length; ii++) {
      const oldMaterial = this._materials[ii]
      const newMaterial = mats[ii]
      if (oldMaterial === newMaterial) continue
      oldMaterial.dispose()
      this._materials[ii] = newMaterial as ThreeMaterial
    }
    for (; ii < this._materials.length; ii++) this._materials[ii].dispose()
    this._materials.length = mats.length
  }

  @property("material", {editable: false}) get materialConfig () :ConfigurableConfig {
    return this.material.createConfig()
  }
  set materialConfig (config :ConfigurableConfig) {
    this.material = this.material.reconfigure(undefined, config) as Material
  }

  get materialConfigs () :ConfigurableConfig[] {
    return this._materials.map(material => material.createConfig())
  }
  set materialConfigs (configs :ConfigurableConfig[]) {
    let ii = 0
    for (; ii < configs.length; ii++) {
      this._materials[ii] = this.gameEngine.reconfigureConfigurable(
        "material",
        this._materials[ii] || null,
        undefined,
        configs[ii],
      ) as ThreeMaterial
    }
    for (; ii < this._materials.length; ii++) {
      this._materials[ii].dispose()
    }
    this._materials.length = configs.length
  }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)

    this._materials = new Proxy(
      [gameEngine.reconfigureConfigurable(
        "material",
        null,
        undefined,
        {type: "basic"},
      ) as ThreeMaterial],
      {
        set: (obj, prop, value) => {
          obj[prop] = value
          this._updateMaterials()
          return true
        },
        get: (obj, prop) => {
          return obj[prop]
        },
      },
    )
    this._updateMaterials()
    this._disposer.add(() => {
      for (const material of this._materials) material.dispose()
    })
    const component =
      this.gameObject.components.getValue("meshFilter") as Value<TypeScriptMeshFilter|undefined>
    this._disposer.add(
      component
        .switchMap(
          meshFilter => meshFilter
            ? meshFilter.meshValue
            : Value.constant<TypeScriptMesh|null>(null),
          )
        .onValue((mesh :any) => {
          if (!(mesh && mesh._bufferGeometry)) {
            this.objectValue.update(undefined)
            return
          }
          const geometry = (mesh && mesh._bufferGeometry) || emptyGeometry
          this._mesh.geometry = geometry
          if (!geometry.boundingBox) geometry.computeBoundingBox()
          this._mesh.userData.boundingBox = geometry.boundingBox
          this.objectValue.update(this._mesh)
          this._boundsValid = false
        }),
    )
  }

  _updateMaterials () {
    this._mesh.material = this._materials.length === 1
      ? this._materials[0].object
      : this._materials.map(mat => mat.object)
  }
}
registerConfigurableType("component", ["render"], "meshRenderer", ThreeMeshRenderer)

const tmpVector2 = new Vector2()
const tmpc = vec2.create()
const tmpVector3 = new Vector3()

type CameraObject = PerspectiveCamera | OrthographicCamera

class ThreeCamera extends ThreeObjectComponent implements Camera {
  @property("number", {min: 0, wheelStep: 0.01}) aspect = 1
  @property("number", {min: 0, max: 180}) fieldOfView = 50
  @property("boolean") orthographic = false
  @property("number", {min: 0, wheelStep: 0.1}) orthographicSize = 10
  @property("number", {min: 0, wheelStep: 0.1}) nearClipPlane = 0.1
  @property("number", {min: 0, wheelStep: 0.1}) farClipPlane = 2000
  @property("vec2") lensShift = vec2.create()
  @property("number") cullingMask = ALL_LAYERS_MASK
  @property("number") eventMask = ALL_LAYERS_MASK

  get cameraObject () :CameraObject { return this.objectValue.current as CameraObject }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    this._addToCameras(this._page)

    // for now, just use the renderer size aspect
    this._disposer.add(this.renderEngine.size.onValue(size => {
      this.aspect = size[0] / size[1]
    }))
  }

  init () {
    super.init()
    const updateOrthographicViewOffset = (camera :OrthographicCamera) => {
      const lensShift = this.lensShift
      const aspect = this.aspect
      if (vec2.equals(lensShift, vec2zero)) camera.clearViewOffset()
      else camera.setViewOffset(aspect, 1, lensShift[0], -lensShift[1], aspect, 1)
      camera.updateProjectionMatrix()
    }
    const updatePerspectiveViewOffset = (camera :PerspectiveCamera) => {
      const lensShift = this.lensShift
      const aspect = this.aspect
      if (vec2.equals(lensShift, vec2zero)) {
        camera.clearViewOffset()
        camera.aspect = aspect
      } else camera.setViewOffset(aspect, 1, lensShift[0], -lensShift[1], aspect, 1)
      camera.updateProjectionMatrix()
    }
    this.getProperty<boolean>("orthographic").onValue(orthographic => {
      if (orthographic) {
        const orthoWidth = this.orthographicSize * this.aspect
        const camera = new OrthographicCamera(
          -orthoWidth,
          orthoWidth,
          this.orthographicSize,
          -this.orthographicSize,
          this.nearClipPlane,
          this.farClipPlane,
        )
        updateOrthographicViewOffset(camera)
        this.objectValue.update(camera)

      } else {
        const camera = new PerspectiveCamera(
          this.fieldOfView,
          this.aspect,
          this.nearClipPlane,
          this.farClipPlane,
        )
        updatePerspectiveViewOffset(camera)
        this.objectValue.update(camera)
      }
    })
    Value
      .join3(
        this.getProperty<number>("aspect"),
        this.getProperty<number>("orthographicSize"),
        this.getProperty<vec2>("lensShift"),
      )
      .onChange(([aspect, orthographicSize, lensShift]) => {
        const camera = this.cameraObject
        if (camera instanceof PerspectiveCamera) {
          updatePerspectiveViewOffset(camera)

        } else { // camera instanceof OrthographicCamera
          const orthoWidth = orthographicSize * aspect
          camera.left = -orthoWidth
          camera.right = orthoWidth
          camera.bottom = -orthographicSize
          camera.top = orthographicSize
          updateOrthographicViewOffset(camera)
        }
      })
    this.getProperty<number>("fieldOfView").onChange(fov => {
      const camera = this.cameraObject
      if (camera instanceof PerspectiveCamera) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    })
    this.getProperty<number>("nearClipPlane").onChange(nearClipPlane => {
      this.cameraObject.near = nearClipPlane
      this.cameraObject.updateProjectionMatrix()
    })
    this.getProperty<number>("farClipPlane").onChange(farClipPlane => {
      this.cameraObject.far = farClipPlane
      this.cameraObject.updateProjectionMatrix()
    })
    this.getProperty<number>("cullingMask").onChange(() => {
      this._updateObjectLayers(this.cameraObject)
    })
  }

  getDirection (target? :vec3) :vec3 {
    return vec3.negate(target || vec3.create(), this.transform.forward)
  }

  screenPointToRay (coords :vec2, target? :Ray) :Ray {
    return this.viewportPointToRay(
      vec2.set(
        tmpc,
        coords[0] / this.renderEngine.domElement.clientWidth,
        1 - coords[1] / this.renderEngine.domElement.clientHeight,
      ),
      target,
    )
  }

  viewportPointToRay (coords :vec2, target?: Ray) :Ray {
    if (!target) target = Ray.create()
    raycaster.setFromCamera(
      tmpVector2.set(coords[0] * 2 - 1, coords[1] * 2 - 1),
      this.cameraObject,
    )
    raycaster.ray.origin.toArray(target.origin)
    raycaster.ray.direction.toArray(target.direction)
    return target
  }

  worldToScreenPoint (coords :vec3, target? :vec3) :vec3 {
    const result = this.worldToViewportPoint(coords, target)
    result[0] *= this.renderEngine.domElement.clientWidth
    result[1] = (1 - result[1]) * this.renderEngine.domElement.clientHeight
    return result
  }

  worldToViewportPoint (coords :vec3, target? :vec3) :vec3 {
    if (!target) target = vec3.create()
    vec3.transformMat4(target, coords, this.transform.worldToLocalMatrix)
    tmpVector3.fromArray(target).applyMatrix4(this.cameraObject.projectionMatrix)
    tmpVector3.toArray(target)
    target[0] = (target[0] + 1) * 0.5
    target[1] = (target[1] + 1) * 0.5
    return target
  }

  onTransformParentChanged () {
    const oldPage = this._page
    super.onTransformParentChanged()
    if (this._page === oldPage) return
    this._removeFromCameras(oldPage)
    this._addToCameras(this._page)
  }

  dispose () {
    super.dispose()
    this._removeFromCameras(this._page)
  }

  protected _updateObjectTransform (object :Object3D) {
    super._updateObjectTransform(object)
    this.cameraObject.matrixWorldInverse.fromArray(this.transform.worldToLocalMatrix)
  }

  protected _updateObjectLayers (object :Object3D) {
    object.layers.mask = this.cullingMask
  }

  protected _addToCameras (page :ThreePage|undefined) {
    const cameras = page ? page.cameras : this.renderEngine.cameras
    cameras.push(this)
  }

  protected _removeFromCameras (page :ThreePage|undefined) {
    const cameras = page ? page.cameras : this.renderEngine.cameras
    cameras.splice(cameras.indexOf(this), 1)
  }
}
registerConfigurableType("component", ["render"], "camera", ThreeCamera)

class ThreeLight extends ThreeObjectComponent implements Light {
  @property("LightType") lightType :LightType = "ambient"
  @property("Color") color = Color.fromRGB(1, 1, 1)
  @property("number", {min: 0, wheelStep: 0.1}) intensity = 1

  get lightObject () :LightObject { return this.objectValue.current as LightObject }

  init () {
    super.init()
    const updateColor = () => this.lightObject.color.fromArray(this.color, 1)
    const updateIntensity = () => this.lightObject.intensity = this.intensity
    this.getProperty<LightType>("lightType").onValue(lightType => {
      this.objectValue.update(lightType === "ambient" ? new AmbientLight() : new DirectionalLight())
      updateColor()
      updateIntensity()
    })
    this.getProperty("color").onChange(updateColor)
    this.getProperty("intensity").onChange(updateIntensity)
  }

  protected _updateObjectLayers (object :Object3D) {
    // lights apply to all layers; otherwise, we end up switching between shaders compiled for 0
    // lights and N lights, and thus recompiling shaders every frame
    object.layers.mask = ALL_LAYERS_MASK
  }
}
registerConfigurableType("component", ["render"], "light", ThreeLight)

class ThreeModel extends ThreeBounded implements Model {
  @property("url") url = ""
  @property("number", {min: 0, wheelStep: 0.01}) opacity = 1

  private _urlRemover :Remover = NoopRemover

  init () {
    super.init()
    Value
      .join2(this.objectValue, this.getProperty<number>("opacity"))
      .onValue(([object, opacity]) => updateOpacity(object, opacity))
  }

  awake () {
    super.awake()
    if (this.gameObject.isStatic) {
      const renderEngine = this.gameEngine.renderEngine as ThreeRenderEngine
      if (renderEngine.mergedStatic) {
        renderEngine.mergedStatic.meshes.add(
          this.url,
          new Matrix4().fromArray(this.transform.localToWorldMatrix),
        )
        return
      }
    }
    this.getProperty<string>("url").onValue(url => {
      this._urlRemover()
      this.objectValue.update(undefined)
      this._urlRemover = loadGLTFWithBoundingBox(this.gameEngine.loader, url).onValue(gltf => {
        this.objectValue.update(SkeletonUtils.clone(gltf.scene) as Object3D)
        this._boundsValid = false
      })
    })
  }

  dispose () {
    super.dispose()
    this._urlRemover()
  }

  protected _updateObjectTransform (object :Object3D) {
    super._updateObjectTransform(object)
    updateChildren(object)
  }
}
registerConfigurableType("component", ["render"], "model", ThreeModel)

class ThreeFusedModels extends ThreeBounded implements FusedModels {
  @property("Uint8Array", {editable: false}) encoded = new Uint8Array(0)
  @property("number", {min: 0, wheelStep: 0.01}) opacity = 1

  private _loadingEncoded? :Uint8Array

  init () {
    super.init()
    Value
      .join2(this.objectValue, this.getProperty<number>("opacity"))
      .onValue(([object, opacity]) => updateOpacity(object, opacity))
  }

  awake () {
    super.awake()

    const positionVector = new Vector3()
    const rotationQuaternion = new Quaternion()
    const scaleVector = new Vector3()
    const decode = (mergedMeshes :MergedMeshes, encoded :Uint8Array, parentMatrix :Matrix4) => {
      decodeFused(encoded, {
        visitTile: (url, bounds, position, rotation, scale, flags) => {
          mergedMeshes.add(
            url,
            new Matrix4()
              .compose(
                positionVector.fromArray(position),
                rotationQuaternion.fromArray(rotation),
                scaleVector.fromArray(scale),
              )
              .premultiply(parentMatrix),
            bounds,
          )
        },
        visitFusedTiles: (source, position, rotation, scale) => {
          decode(
            mergedMeshes,
            source,
            new Matrix4()
              .compose(
                positionVector.fromArray(position),
                rotationQuaternion.fromArray(rotation),
                scaleVector.fromArray(scale),
              )
              .premultiply(parentMatrix),
          )
        }
      })
    }
    if (this.gameObject.isStatic) {
      const renderEngine = this.gameEngine.renderEngine as ThreeRenderEngine
      if (renderEngine.mergedStatic) {
        decode(
          renderEngine.mergedStatic.meshes,
          this.encoded,
          new Matrix4().fromArray(this.transform.localToWorldMatrix),
        )
        return
      }
    }
    this.getProperty<Uint8Array>("encoded").onValue(encoded => {
      const mergedMeshes = new MergedMeshes(this.gameEngine)
      decode(mergedMeshes, encoded, new Matrix4())

      this.objectValue.update(undefined)
      this._loadingEncoded = encoded
      mergedMeshes.build(group => {
        if (this._loadingEncoded === encoded) {
          this.objectValue.update(group)
          this._boundsValid = false
        }
      })
    })
  }

  protected _updateObjectTransform (object :Object3D) {
    super._updateObjectTransform(object)
    updateChildren(object)
  }
}
registerConfigurableType("component", undefined, "fusedModels", ThreeFusedModels)

function updateOpacity (object :Object3D|undefined, opacity :number) {
  if (!object) return
  const currentOpacity = getValue(object.userData.opacity, 1)
  if (currentOpacity === opacity) return
  const cloned = object.userData.opacity !== undefined
  const modifyMaterial = (material :MaterialObject) => {
    if (!cloned) {
      material = material.clone()
      material.transparent = true
    }
    material.opacity = opacity
    return material
  }
  object.traverse(node => {
    if (node instanceof Mesh) {
      if (Array.isArray(node.material)) {
        for (let ii = 0; ii < node.material.length; ii++) {
          node.material[ii] = modifyMaterial(node.material[ii])
        }
      } else node.material = modifyMaterial(node.material)
    }
  })
  object.userData.opacity = opacity
}

const PlaceholderGLTF = Subject.constant<GLTF>({
  scene: new Mesh(
    new BoxBufferGeometry().translate(0, 0.5, 0),
    new MeshBasicMaterial({color: 0xFF0000}),
  ),
  animations: [],
})

function loadGLTFWithBoundingBox (loader :ResourceLoader, url :string) :Subject<GLTF> {
  return (url ? loadGLTF(loader, url) : PlaceholderGLTF).map(gltf => {
    const userData = gltf.scene.userData
    if (userData.boundingBox) return gltf
    const sceneBoundingBox = userData.boundingBox = new Box3()
    const meshBoundingBox = new Box3()
    gltf.scene.traverse(node => {
      node.updateWorldMatrix(false, false)
      if (!(node instanceof Mesh)) return
      node.geometry.computeBoundingBox()
      node.geometry.boundingSphere = node.geometry.boundingBox.getBoundingSphere(new Sphere())
      meshBoundingBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld)
      sceneBoundingBox.union(meshBoundingBox)
    })
    return gltf
  })
}

setEnumMeta("WrapMode", WrapModes)

class ThreeAnimation extends TypeScriptComponent implements Animation {
  @property("select") playAutomatically = ""
  @property("select") playing = ""
  @property("WrapMode") wrapMode :WrapMode = "loop"
  @property("number", {min: 0, wheelStep: 0.1}) timeScale = 1
  @property("number", {min: 0}) repetitions = Infinity

  readonly urlsValue = Mutable.local<string[]>([])

  private readonly _urls :string[]
  private _modelUrlsStart = 0
  private _modelUrlsCount = 0
  private readonly _mixerSubject :Subject<AnimationMixer>
  private _mixer? :AnimationMixer
  private readonly _urlsByName = new Map<string, string>()

  get url () :string|undefined { return this.urls[0] }
  set url (url :string|undefined) {
    if (url === undefined) this._urls.length = 0
    else this._urls[0] = url
  }

  get urls () :string[] { return this._urls }
  set urls (urls :string[]) {
    this._urls.length = urls.length
    for (let ii = 0; ii < urls.length; ii++) this._urls[ii] = urls[ii]
  }

  get propertiesMeta () :RMap<string, PropertyMeta> {
    return RMap.fromValue(this.urlsValue, urls => {
      const map = MutableMap.local<string, PropertyMeta>()
      const options = urls.map(getAnchor)
      options.unshift("")
      for (const [property, meta] of getConfigurableMeta(Object.getPrototypeOf(this)).properties) {
        const playing = (property === "playing")
        if (playing || property === "playAutomatically") {
          map.set(property, {type: "select", constraints: {options, transient: playing}})
        }
        else map.set(property, meta)
      }
      return map
    })
  }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)

    this._urls = new Proxy([], {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._updateUrls()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })

    const component = this.gameObject.components.getValue("model") as Value<ThreeModel|undefined>
    this._mixerSubject = Subject.deriveSubject(dispatch => {
      return component
        .switchMap(
          model => model ? model.objectValue : Value.constant<Object3D|undefined>(undefined),
        )
        .onValue(object => {
          if (object) dispatch(new AnimationMixer(object))
        })
    })
    this._disposer.add(this._mixerSubject.onValue(mixer => {
      this._mixer = mixer
      mixer.addEventListener("finished", () => {
        if (!this._clampWhenFinished) this.playing = ""
      })
      if (this.playing) this._requireClip(this.playing).once(clip => this._playClip(clip, mixer))
    }))

    // automatically add the URLs of any model loaded
    this._disposer.add(
      component
        .switchMap(model => model ? model.getProperty<string>("url") : Value.blank)
        .onValue(url => {
          this.playing = ""
          if (this._modelUrlsCount > 0) {
            this._urls.splice(this._modelUrlsStart, this._modelUrlsCount)
            this._modelUrlsCount = 0
            this._updateUrls()
          }
          if (!url) return
          loadGLTF(this.gameEngine.loader, url).onValue(gltf => {
            this._modelUrlsStart = this._urls.length
            for (const clip of gltf.animations) {
              const fullUrl = url + "#" + clip.name
              if (this._urls.indexOf(fullUrl) === -1) this._urls.push(url + "#" + clip.name)
            }
            this._modelUrlsCount = this._urls.length - this._modelUrlsStart
            this._updateUrls()
          })
        }),
    )
  }

  init () {
    super.init()
    this.getProperty<string>("playing").onValue(nameOrUrl => {
      if (nameOrUrl) {
        Subject.join2(this._requireClip(nameOrUrl), this._mixerSubject).once(([clip, mixer]) => {
          this._playClip(clip, mixer)
        })
      } else {
        this._mixerSubject.once(mixer => mixer.stopAllAction())
      }
    })
    this.getProperty<WrapMode>("wrapMode").onValue(mode => {
      const nameOrUrl = this.playing
      if (!nameOrUrl) return
      Subject.join2(this._requireClip(nameOrUrl), this._mixerSubject).once(([clip, mixer]) => {
        mixer.clipAction(clip).setLoop(this._loopMode, this.repetitions)
      })
    })
    for (const property of ["timeScale", "repetitions"]) {
      this.getProperty<number>(property).onValue(value => {
        const nameOrUrl = this.playing
        if (!nameOrUrl) return
        Subject.join2(this._requireClip(nameOrUrl), this._mixerSubject).once(([clip, mixer]) => {
          mixer.clipAction(clip)[property] = value
        })
      })
    }
    Value
      .join2(this.getProperty<string>("playAutomatically"), this.urlsValue)
      .onChange(([playAutomatically]) => {
        if (this._urlsByName.has(playAutomatically)) this.playing = playAutomatically
      })
  }

  private _playClip (clip :AnimationClip, mixer :AnimationMixer) {
    const action = mixer.stopAllAction().clipAction(clip)
    action.clampWhenFinished = this._clampWhenFinished
    action.timeScale = this.timeScale
    action.setLoop(this._loopMode, this.repetitions).stop().play()
  }

  private get _loopMode () :number {
    switch (this.wrapMode) {
      case "once": case "clampForever": return LoopOnce
      case "loop": return LoopRepeat
      case "pingPong": return LoopPingPong
      default: throw new Error(`Unknown wrap mode "${this.wrapMode}"`)
    }
  }

  private get _clampWhenFinished () :boolean {
    return this.wrapMode === "clampForever"
  }

  private _requireClip (nameOrUrl? :string) :Subject<AnimationClip> {
    if (nameOrUrl === undefined) nameOrUrl = this._urls[0]
    else {
      const urlForName = this._urlsByName.get(nameOrUrl)
      if (urlForName) nameOrUrl = urlForName
    }
    return loadGLTFAnimationClip(this.gameEngine.loader, nameOrUrl)
  }

  update (clock :Clock) {
    if (this._mixer) {
      this._mixer.update(clock.dt)
      updateChildren(this._mixer.getRoot())
    }
  }

  private _updateUrls () {
    this._urlsByName.clear()
    for (const url of this._urls) this._urlsByName.set(getAnchor(url), url)
    this.urlsValue.update(this._urls.slice())
  }
}
registerConfigurableType("component", ["render"], "animation", ThreeAnimation)

function updateChildren (object :Object3D) {
  for (const child of object.children) child.updateMatrixWorld(true)
}

function getAnchor (url :string) {
  return url.substring(url.lastIndexOf("#") + 1)
}

class ThreeMergedStatic extends ThreeObjectComponent {
  readonly meshes :MergedMeshes

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    this.meshes = new MergedMeshes(gameEngine)
  }

  build () {
    this.meshes.build(group => this.objectValue.update(group))
  }
}
registerConfigurableType("component", undefined, "mergedStatic", ThreeMergedStatic)

/** Handles the merging of a group of models into combined meshes. */
class MergedMeshes {
  private readonly _models = new Map<string, {matrices :Matrix4[], bounds? :Bounds}>()

  constructor (readonly gameEngine :TypeScriptGameEngine) {}

  /** Adds a model instance to the merged group.
    * @param url the URL of the model to add.
    * @param matrix the transform matrix of the model relative to the merged group.
    * @param [bounds] the tile bounds of the model, if any. */
  add (url :string, matrix :Matrix4, bounds? :Bounds) {
    let model = this._models.get(url)
    if (!model) this._models.set(url, model = {matrices: [], bounds})
    model.matrices.push(matrix)
  }

  /** Builds the merged group.
    * @param onFinish a callback to receive the created group when loaded and built. */
  build (onFinish :(group :Group) => void) {
    // wait until we have all of the required models
    Subject
      .join(...Array.from(this._models.keys(),
                          path => loadGLTFWithBoundingBox(this.gameEngine.loader, path)))
      .once(gltfs => {
        const applyToModels = (op :(gltf :GLTF, matrices :Matrix4[], bounds? :Bounds) => void) => {
          let ii = 0
          for (const {matrices, bounds} of this._models.values()) op(gltfs[ii++], matrices, bounds)
        }

        // compute the combined bounds (both tile bounds, which we store in the group for snapping,
        // and geometry bounds, which we use for rendering and raycasting)
        const group = new Group()
        const tileBoundingBox = group.userData.boundingBox = new Box3()
        const geomBoundingBox = new Box3()
        const tmpBoundingBox = new Box3()
        applyToModels((gltf, matrices, bounds) => {
          for (const matrix of matrices) {
            tmpBoundingBox.copy(gltf.scene.userData.boundingBox)
            geomBoundingBox.union(tmpBoundingBox.applyMatrix4(matrix))
            if (bounds) {
              tmpBoundingBox.min.fromArray(bounds.min)
              tmpBoundingBox.max.fromArray(bounds.max)
              tileBoundingBox.union(tmpBoundingBox.applyMatrix4(matrix))
            } else tileBoundingBox.union(tmpBoundingBox)
          }
        })

        type MeshPartOp = (
          material :MaterialObject,
          mesh :Mesh,
          start :number,
          count :number,
          matrices :Matrix4[],
        ) => void
        const applyToMeshParts = (op :MeshPartOp) => {
          applyToModels((gltf, matrices) => {
            gltf.scene.traverse(node => {
              if (!(
                node instanceof Mesh &&
                node.geometry instanceof BufferGeometry &&
                node.geometry.index
              )) return
              if (Array.isArray(node.material)) {
                for (const group of node.geometry.groups) {
                  const material = node.material[group.materialIndex || 0]
                  op(material, node, group.start, group.count, matrices)
                }
              } else op(node.material, node, 0, node.geometry.index.count, matrices)
            })
          })
        }

        // find out how many meshes and vertices we're going to need
        interface Stats {
          vertices :number
          indices :number
          color :boolean
          mesh :OctreeMesh
        }
        const stats = new Map<Texture|undefined, Stats>()
        applyToMeshParts((material, mesh, start, count, matrices) => {
          const texture = material["map"] as Texture|undefined
          let textureStats = stats.get(texture)
          if (!textureStats) {
            stats.set(texture, textureStats = {
              vertices: 0,
              indices: 0,
              color: false,
              mesh: new OctreeMesh(new BufferGeometry(), material, geomBoundingBox),
            })
          }
          const geometry = mesh.geometry as BufferGeometry
          textureStats.vertices += geometry.getAttribute("position").count * matrices.length
          textureStats.indices += count * matrices.length
          textureStats.color = textureStats.color || !!geometry.getAttribute("color")
        })

        // create and add the meshes
        for (const [texture, textureStats] of stats) {
          const geometry = textureStats.mesh.geometry as BufferGeometry
          geometry.boundingBox = new Box3()
          group.add(textureStats.mesh)
          const vertices = textureStats.vertices
          const IndexArrayType = vertices < 65536 ? Uint16Array : Uint32Array
          geometry.setIndex(new BufferAttribute(new IndexArrayType(textureStats.indices), 1))
          geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3))
          geometry.setAttribute("normal", new BufferAttribute(new Float32Array(vertices * 3), 3))
          if (texture) {
            geometry.setAttribute("uv", new BufferAttribute(new Float32Array(vertices * 2), 2))
          }
          if (textureStats.color) {
            geometry.setAttribute("color", new BufferAttribute(new Float32Array(vertices * 3), 3))
          }
          // restart the counts for population
          textureStats.indices = 0
          textureStats.vertices = 0
        }

        // populate the meshes
        const partMatrix = new Matrix4()
        const m = partMatrix.elements
        const normalMatrix = new Matrix3()
        const n = normalMatrix.elements
        applyToMeshParts((material, mesh, start, count, matrices) => {
          const textureStats = stats.get(material["map"] as Texture|undefined)!
          const destGeometry = textureStats.mesh.geometry as BufferGeometry
          const srcGeometry = mesh.geometry as BufferGeometry
          const srcPositionAttribute = srcGeometry.getAttribute("position")
          const vertices = srcPositionAttribute.count
          const destPosition = destGeometry.getAttribute("position").array as Float32Array
          const srcPosition = srcPositionAttribute.array as Float32Array
          const destNormal = destGeometry.getAttribute("normal").array as Float32Array
          const srcNormalAttribute = srcGeometry.getAttribute("normal")
          const srcNormal = srcNormalAttribute && srcNormalAttribute.array as Float32Array
          const destColorAttribute = destGeometry.getAttribute("color")
          const destColor = destColorAttribute && destColorAttribute.array as Float32Array
          const srcColorAttribute = srcGeometry.getAttribute("color")
          const srcColor = srcColorAttribute && srcColorAttribute.array as Float32Array
          const destUVAttribute = destGeometry.getAttribute("uv")
          const destUV = destUVAttribute && destUVAttribute.array as Float32Array
          const srcUVAttribute = srcGeometry.getAttribute("uv")
          const srcUV = srcUVAttribute && srcUVAttribute.array as Float32Array
          const destIndices = destGeometry.index.array as Uint16Array|Uint32Array
          const srcIndices = srcGeometry.index.array
          for (const matrix of matrices) {
            partMatrix.multiplyMatrices(matrix, mesh.matrixWorld)
            tmpBoundingBox.copy(srcGeometry.boundingBox).applyMatrix4(partMatrix)
            destGeometry.boundingBox.union(tmpBoundingBox)
            textureStats.mesh.addToOctree(mesh, partMatrix.clone(), tmpBoundingBox.clone())

            // transfer positions with transform
            const offset = textureStats.vertices
            for (let srcIdx = 0, srcEnd = vertices * 3, destIdx = offset * 3; srcIdx < srcEnd; ) {
              const sx = srcPosition[srcIdx++]
              const sy = srcPosition[srcIdx++]
              const sz = srcPosition[srcIdx++]
              destPosition[destIdx++] = m[0]*sx + m[4]*sy + m[8]*sz + m[12]
              destPosition[destIdx++] = m[1]*sx + m[5]*sy + m[9]*sz + m[13]
              destPosition[destIdx++] = m[2]*sx + m[6]*sy + m[10]*sz + m[14]
            }

            // transfer normals
            if (srcNormal) {
              normalMatrix.getNormalMatrix(partMatrix)
              for (let srcIdx = 0, srcEnd = vertices * 3, destIdx = offset * 3; srcIdx < srcEnd; ) {
                const sx = srcNormal[srcIdx++]
                const sy = srcNormal[srcIdx++]
                const sz = srcNormal[srcIdx++]
                destNormal[destIdx++] = n[0]*sx + n[3]*sy + n[6]*sz
                destNormal[destIdx++] = n[1]*sx + n[4]*sy + n[7]*sz
                destNormal[destIdx++] = n[2]*sx + n[5]*sy + n[8]*sz
              }
            }

            // transfer colors
            if (destColor) {
              if (srcColor) {
                if (srcColorAttribute.itemSize === 3) destColor.set(srcColor, offset * 3)
                else if (srcColorAttribute.itemSize === 4) {
                  for (
                    let srcIdx = 0, srcEnd = vertices * 4, destIdx = offset * 3;
                    srcIdx < srcEnd;
                  ) {
                    destColor[destIdx++] = srcColor[srcIdx++]
                    destColor[destIdx++] = srcColor[srcIdx++]
                    destColor[destIdx++] = srcColor[srcIdx++]
                    srcIdx++ // skip unused alpha component
                  }
                }
              } else destColor.fill(1, offset * 3, (offset + vertices) * 3)
            }

            // transfer uvs
            if (destUV && srcUV) destUV.set(srcUV, offset * 2)

            // transfer indices with offset
            for (
              let srcIdx = start, srcEnd = start + count, destIdx = textureStats.indices;
              srcIdx < srcEnd;
            ) {
              destIndices[destIdx++] = srcIndices[srcIdx++] + offset
            }
            textureStats.vertices += vertices
            textureStats.indices += count
          }
        })

        // compute bounding spheres from boxes
        for (const textureStats of stats.values()) {
          textureStats.mesh.geometry.boundingSphere =
            textureStats.mesh.geometry.boundingBox.getBoundingSphere(new Sphere())
        }

        // notify the listener
        onFinish(group)
      })
  }
}

const tmpSphere = new Sphere()
const inverseMatrix = new Matrix4()
const tmpRay = new RayObject()
const nodeBounds = new Box3()

const MAX_DEPTH = 8

let currentOctreeVisit = 0

/** A mesh that uses an internal octree to accelerate raycasting. */
class OctreeMesh extends Mesh {
  private readonly _root = new OctreeNode()
  private readonly _boundingBoxSize :number

  constructor (
    geometry :BufferGeometry,
    material :MaterialObject,
    private readonly _boundingBox :Box3,
  ) {
    super(geometry, material)
    this._boundingBoxSize = getBoundingBoxSize(_boundingBox)
  }

  addToOctree (mesh :Mesh, matrix :Matrix4, boundingBox :Box3) {
    const occupant = new OctreeOccupant(mesh, matrix, boundingBox)
    const boxSize = getBoundingBoxSize(boundingBox)
    const depth = (boxSize === 0)
      ? 0
      : Math.min(MAX_DEPTH, -Math.round(Math.log(boxSize / this._boundingBoxSize) / Math.log(2)))
    nodeBounds.copy(this._boundingBox)
    this._root.insert(occupant, depth)
  }

  raycast (raycaster :Raycaster, intersects :Intersection[]) {
    // first check against sphere in world space (as Three.js does)
    tmpSphere.copy(this.geometry.boundingSphere).applyMatrix4(this.matrixWorld)
    if (!raycaster.ray.intersectsSphere(tmpSphere)) return

    // store the original ray and transform into local space
    tmpRay.copy(raycaster.ray)
    inverseMatrix.getInverse(this.matrixWorld)
    raycaster.ray.applyMatrix4(inverseMatrix)

    // intersect against octree, then restore original ray
    currentOctreeVisit++
    nodeBounds.copy(this._boundingBox)
    const previousIntersects = intersects.length
    this._root.raycast(raycaster, intersects)
    raycaster.ray.copy(tmpRay)

    // transform any intersections to world space
    for (let ii = previousIntersects; ii < intersects.length; ii++) {
      const intersect = intersects[ii]
      intersect.point.applyMatrix4(this.matrixWorld)
      intersect.distance = intersect.point.distanceTo(raycaster.ray.origin)
      intersect.object = this
    }
  }
}

function getBoundingBoxSize (box :Box3) {
  return Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
}

class OctreeOccupant {
  lastVisit? :number

  constructor (readonly mesh :Mesh, readonly matrix :Matrix4, readonly boundingBox :Box3) {}
}

class OctreeNode {
  occupants? :OctreeOccupant[]
  children? :OctreeNode[]

  insert (occupant :OctreeOccupant, depth :number) {
    if (depth === 0) {
      if (!this.occupants) this.occupants = []
      this.occupants.push(occupant)
      return
    }
    const minX = nodeBounds.min.x, minY = nodeBounds.min.y, minZ = nodeBounds.min.z
    const halfSizeX = (nodeBounds.max.x - minX) * 0.5
    const halfSizeY = (nodeBounds.max.y - minY) * 0.5
    const halfSizeZ = (nodeBounds.max.z - minZ) * 0.5
    for (let ii = 0; ii < 8; ii++) {
      const offsetX = (ii & 1) ? halfSizeX : 0
      const offsetY = (ii & 2) ? halfSizeY : 0
      const offsetZ = (ii & 4) ? halfSizeZ : 0
      nodeBounds.min.set(minX + offsetX, minY + offsetY, minZ + offsetZ)
      nodeBounds.max.set(
        nodeBounds.min.x + halfSizeX,
        nodeBounds.min.y + halfSizeY,
        nodeBounds.min.z + halfSizeZ,
      )
      if (occupant.boundingBox.intersectsBox(nodeBounds)) {
        if (!this.children) this.children = []
        let child = this.children[ii]
        if (!child) this.children[ii] = child = new OctreeNode()
        child.insert(occupant, depth - 1)
      }
    }
  }

  raycast (raycaster :Raycaster, intersects :Intersection[]) {
    if (this.occupants) {
      for (const occupant of this.occupants) {
        if (occupant.lastVisit === currentOctreeVisit) continue
        occupant.lastVisit = currentOctreeVisit
        const previousMatrixWorld = occupant.mesh.matrixWorld
        occupant.mesh.matrixWorld = occupant.matrix
        try {
          occupant.mesh.raycast(raycaster, intersects)
        } finally {
          occupant.mesh.matrixWorld = previousMatrixWorld
        }
      }
    }
    if (!this.children) return
    const minX = nodeBounds.min.x, minY = nodeBounds.min.y, minZ = nodeBounds.min.z
    const halfSizeX = (nodeBounds.max.x - minX) * 0.5
    const halfSizeY = (nodeBounds.max.y - minY) * 0.5
    const halfSizeZ = (nodeBounds.max.z - minZ) * 0.5
    for (let ii = 0; ii < 8; ii++) {
      const child = this.children[ii]
      if (!child) continue
      const offsetX = (ii & 1) ? halfSizeX : 0
      const offsetY = (ii & 2) ? halfSizeY : 0
      const offsetZ = (ii & 4) ? halfSizeZ : 0
      nodeBounds.min.set(minX + offsetX, minY + offsetY, minZ + offsetZ)
      nodeBounds.max.set(
        nodeBounds.min.x + halfSizeX,
        nodeBounds.min.y + halfSizeY,
        nodeBounds.min.z + halfSizeZ,
      )
      if (raycaster.ray.intersectsBox(nodeBounds)) child.raycast(raycaster, intersects)
    }
  }
}
