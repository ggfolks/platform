import {
  AnimationClip, AnimationMixer, AmbientLight, BoxBufferGeometry, BufferGeometry,
  CylinderBufferGeometry, DirectionalLight, Intersection, Light as LightObject,
  Material as MaterialObject, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PerspectiveCamera, PlaneBufferGeometry, Raycaster, Scene, ShaderMaterial, SphereBufferGeometry,
  Vector2, WebGLRenderer,
} from "three"
import {SkeletonUtils} from "three/examples/jsm/utils/SkeletonUtils"
import {Clock} from "../../../core/clock"
import {Color} from "../../../core/color"
import {Plane, dim2, rect, vec2, vec3} from "../../../core/math"
import {Mutable, Subject, Value} from "../../../core/react"
import {MutableMap} from "../../../core/rcollect"
import {Disposer, NoopRemover, Remover} from "../../../core/util"
import {Graph, GraphConfig} from "../../../graph/graph"
import {setEnumMeta} from "../../../graph/meta"
import {loadGLTF, loadGLTFAnimationClip} from "../../../scene3/entity"
import {Hand, Pointer} from "../../../input/hand"
import {DEFAULT_PAGE, ConfigurableConfig, Hover, Transform} from "../../game"
import {Animation} from "../../animation"
import {property} from "../../meta"
import {
  Camera, Light, LightType, Material, MeshRenderer, Model, RaycastHit, RenderEngine,
} from "../../render"
import {
  TypeScriptComponent, TypeScriptConfigurable, TypeScriptCube, TypeScriptCylinder,
  TypeScriptGameEngine, TypeScriptGameObject, TypeScriptMesh, TypeScriptMeshFilter, TypeScriptPage,
  TypeScriptQuad, TypeScriptSphere, registerConfigurableType,
} from "../game"

setEnumMeta("LightType", ["ambient", "directional"])

const defaultCamera = new PerspectiveCamera()
const raycaster :Raycaster = new Raycaster()
const raycasterResults :Intersection[] = []
const raycastHits :RaycastHit[] = []

const coords = vec2.create()
const rayDirection = vec3.create()
const tmpv = vec3.create()
const tmpp = vec3.create()
const tmpPlane = Plane.create()
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

  readonly renderer = new WebGLRenderer()
  readonly domElement = this.renderer.domElement
  readonly scene = new Scene()
  readonly cameras :ThreeCamera[] = []

  get size () :Value<dim2> { return this._size }

  constructor (readonly gameEngine :TypeScriptGameEngine) {
    gameEngine._renderEngine = this

    this._disposer.add(this.renderer)
    this._disposer.add(this.scene)

    // settings recommended for GLTF loader:
    // https://threejs.org/docs/index.html#examples/en/loaders/GLTFLoader
    this.renderer.gammaOutput = true
    this.renderer.gammaFactor = 2.2

    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"

    gameEngine.root.appendChild(this.renderer.domElement)
    this._disposer.add(() => gameEngine.root.removeChild(this.renderer.domElement))
    this._disposer.add(gameEngine.ctx.screen.onValue(b => this.setBounds(b)))

    this._disposer.add(gameEngine.ctx.hand = this._hand = new Hand(this.renderer.domElement))

    this.scene.autoUpdate = false
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
    target? :RaycastHit[],
  ) :RaycastHit[] {
    raycaster.near = minDistance
    raycaster.far = maxDistance
    raycaster.ray.origin.fromArray(origin)
    raycaster.ray.direction.fromArray(direction)
    raycasterResults.length = 0
    const activePage = this._getActivePage()
    raycaster.intersectObject(activePage ? activePage.scene : this.scene, true, raycasterResults)
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

  updateHovers () {
    this._hand.update()
    hovered.clear()
    const activePage = this._getActivePage()
    const cameras = activePage ? activePage.cameras : this.cameras
    for (const camera of cameras) {
      for (const [identifier, pointer] of this._hand.pointers) {
        const rayOrigin = camera.transform.position
        camera.screenPointToDirection(
          vec2.set(coords, pointer.position[0], pointer.position[1]),
          rayDirection,
        )

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
              const distance = Plane.intersectRay(tmpPlane, rayOrigin, rayDirection)
              if (distance >= 0) vec3.scaleAndAdd(tmpp, rayOrigin, rayDirection, distance)
              else vec3.copy(tmpp, hover.worldPosition)
              this._maybeNoteHovered(identifier, pointer, camera, pressedObject, tmpp)
              continue
            }
          } else {
            this._pressedObjects.delete(identifier)
          }
        }

        this.raycastAll(rayOrigin, rayDirection, 0, Infinity, raycastHits)
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
        if (!noted) {
          // use intersection with a plane one unit in front of the camera
          const dp = vec3.dot(camera.getDirection(tmpv), rayDirection)
          this._maybeNoteHovered(
            identifier,
            pointer,
            camera,
            camera,
            vec3.scaleAndAdd(tmpp, rayOrigin, rayDirection, 1 / dp),
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
    const activePage = this._getActivePage()
    let cameras :ThreeCamera[]
    let scene :Scene
    if (activePage) {
      cameras = activePage.cameras
      scene = activePage.scene
    } else {
      cameras = this.cameras
      scene = this.scene
    }
    this.renderer.render(scene, cameras.length > 0 ? cameras[0].camera : defaultCamera)
  }

  protected _getActivePage () :ThreePage|undefined {
    const activePage = this.gameEngine.activePage.current
    return (activePage === DEFAULT_PAGE)
      ? undefined
      : this.gameEngine.gameObjects.require(activePage).requireComponent<ThreePage>("page")
  }

  dispose () {
    this._disposer.dispose()
  }
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

abstract class ThreeMaterial extends TypeScriptConfigurable implements Material {

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
    readonly object :MaterialObject,
  ) {
    super(gameEngine, supertype, type)
    this._disposer.add(object)
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

  get vertexShaderGraphConfig () :GraphConfig { return this._vertexShaderGraph.config }
  set vertexShaderGraphConfig (config :GraphConfig) {
    this._vertexShaderGraph.reconfigure(config)
    this.object.vertexShader = this._vertexShaderGraph.createVertexShader()
  }

  get fragmentShaderGraphConfig () :GraphConfig { return this._fragmentShaderGraph.config }
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

abstract class ThreeObjectComponent extends TypeScriptComponent {
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
        object.userData.transform = this.transform
        this._addToPage(this._page, object)
      }
    }))
  }

  onTransformChanged () {
    const object = this.objectValue.current
    if (object) this._updateObjectTransform(object)
  }

  onTransformParentChanged () {
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
    for (const identifier of this.hovers.keys()) {
      if (!map.has(identifier)) {
        this.hovers.delete(identifier)
        this.sendMessage("onHoverEnd", identifier)
      }
    }
    // add/update everything in the map
    for (const [identifier, hover] of map) {
      this.hovers.set(identifier, hover)
      this.sendMessage("onHover", identifier, hover)
    }
  }

  protected _updateObjectTransform (object :Object3D) {
    object.matrixWorld.fromArray(this.transform.localToWorldMatrix)
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

const emptyGeometry = new BufferGeometry()

class ThreeMeshRenderer extends ThreeObjectComponent implements MeshRenderer {
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

  get materialConfig () :ConfigurableConfig { return this.material.createConfig() }
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

    this.objectValue.update(this._mesh)
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
          this._mesh.geometry = (mesh && mesh._bufferGeometry) || emptyGeometry
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

class ThreeCamera extends ThreeObjectComponent implements Camera {
  private _perspectiveCamera = new PerspectiveCamera()

  get camera () :PerspectiveCamera { return this._perspectiveCamera }

  get aspect () :number { return this._perspectiveCamera.aspect }
  set aspect (aspect :number) {
    if (this._perspectiveCamera.aspect === aspect) return
    this._perspectiveCamera.aspect = aspect
    this._perspectiveCamera.updateProjectionMatrix()
  }

  get fieldOfView () :number { return this._perspectiveCamera.fov }
  set fieldOfView (fov :number) {
    if (this._perspectiveCamera.fov === fov) return
    this._perspectiveCamera.fov = fov
    this._perspectiveCamera.updateProjectionMatrix()
  }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    this.objectValue.update(this._perspectiveCamera)
    this._addToCameras(this._page)

    // for now, just use the renderer size aspect
    this._disposer.add(this.renderEngine.size.onValue(size => {
      this.aspect = size[0] / size[1]
    }))
  }

  getDirection (target? :vec3) :vec3 {
    return this.viewportPointToDirection(vec2.set(tmpc, 0.5, 0.5), target)
  }

  screenPointToDirection (coords :vec2, target? :vec3) :vec3 {
    return this.viewportPointToDirection(
      vec2.set(
        tmpc,
        coords[0] / this.renderEngine.domElement.clientWidth,
        1 - coords[1] / this.renderEngine.domElement.clientHeight,
      ),
      target,
    )
  }

  viewportPointToDirection (coords :vec2, target? :vec3) :vec3 {
    if (!target) target = vec3.create()
    raycaster.setFromCamera(
      tmpVector2.set(coords[0] * 2 - 1, coords[1] * 2 - 1),
      this._perspectiveCamera,
    )
    return raycaster.ray.direction.toArray(target) as vec3
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
    this._perspectiveCamera.matrixWorldInverse.fromArray(this.transform.worldToLocalMatrix)
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
  private _lightType :LightType = "ambient"
  private _color :Color
  private _lightObject? :LightObject

  @property("LightType") get lightType () :LightType { return this._lightType }
  set lightType (type :LightType) {
    if (type === this._lightType) return
    this._lightType = type
    this._updateLightType()
  }

  get color () :Color { return this._color }
  set color (color :Color) { Color.copy(this._color, color) }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)

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
    this._updateLightType()
  }

  private _updateLightType () {
    this.objectValue.update(
      this._lightObject = (this._lightType === "ambient")
        ? new AmbientLight()
        : new DirectionalLight()
    )
    this._updateColor()
    this._updateObjectTransform(this._lightObject)
  }

  private _updateColor () {
    this._lightObject!.color.fromArray(this._color, 1)
  }
}
registerConfigurableType("component", ["render"], "light", ThreeLight)

class ThreeModel extends ThreeObjectComponent implements Model {
  readonly urlValue = Mutable.local("")

  private _urlRemover :Remover = NoopRemover

  @property("url") get url () :string { return this.urlValue.current }
  set url (url :string) { this.urlValue.update(url) }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    this._disposer.add(this.urlValue.onChange(url => {
      this._urlRemover()
      this.objectValue.update(undefined)
      if (!url) return
      this._urlRemover = loadGLTF(url).onValue(gltf => {
        this.objectValue.update(SkeletonUtils.clone(gltf.scene) as Object3D)
      })
    }))
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

class ThreeAnimation extends TypeScriptComponent implements Animation {
  playAutomatically = true

  private readonly _urls :string[]
  private readonly _mixerSubject :Subject<AnimationMixer>
  private _mixer? :AnimationMixer
  private readonly _clipsByUrl = new Map<string, Subject<AnimationClip>>()
  private readonly _clipsByName = new Map<string, Subject<AnimationClip>>()

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

    this._mixerSubject = Subject.deriveSubject(dispatch => {
      const component = this.gameObject.components.getValue("model") as Value<ThreeModel|undefined>
      return component
        .switchMap(
          model => model ? model.objectValue : Value.constant<Object3D|undefined>(undefined),
        )
        .onValue(object => {
          if (object) dispatch(new AnimationMixer(object))
        })
    })
    this._disposer.add(this._mixerSubject.onValue(mixer => this._mixer = mixer))
  }

  awake () {
    if (this.playAutomatically) this.play()
  }

  play (name? :string) :void {
    let clip :Subject<AnimationClip>|undefined
    if (name !== undefined) clip = this._clipsByName.get(name)
    else clip = this._clipsByUrl.get(this._urls[0])
    if (!clip) throw new Error(`Unknown animation clip "${name}"`)
    Subject.join2(clip, this._mixerSubject).once(([clip, mixer]) => {
      mixer.clipAction(clip).play()
    })
  }

  update (clock :Clock) {
    if (this._mixer) {
      this._mixer.update(clock.dt)
      updateChildren(this._mixer.getRoot())
    }
  }

  private _updateUrls () {
    // remove any clips no longer in the set
    const urlSet = new Set(this._urls)
    for (const url of this._clipsByUrl.keys()) {
      if (!urlSet.has(url)) {
        this._clipsByUrl.delete(url)
        this._clipsByName.delete(getAnchor(url))
      }
    }
    // add any new clips
    for (const url of this._urls) {
      if (!this._clipsByUrl.has(url)) {
        const clip = loadGLTFAnimationClip(url)
        this._clipsByUrl.set(url, clip)
        this._clipsByName.set(getAnchor(url), clip)
      }
    }
  }
}
registerConfigurableType("component", ["render"], "animation", ThreeAnimation)

function updateChildren (object :Object3D) {
  for (const child of object.children) child.updateMatrixWorld(true)
}

function getAnchor (url :string) {
  return url.substring(url.lastIndexOf("#") + 1)
}
